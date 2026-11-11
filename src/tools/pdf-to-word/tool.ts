import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { PdfLocked, openWithFonts, readPageContent, type PictureFile } from "../../lib/pdf/page-content";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { buildDocx, wordName } from "./docx";
import { layoutPage, type PageLayout } from "./paragraphs";

const t = en.pdfToWord;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Pictures are saved up to this many pixels for each point they fill, sharp enough to print.
const PICTURE_DENSITY = 3;
// Past this many pages, the document would be too large to build on a phone.
export const MAX_PAGES = 500;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    orderMatters: false,
    minFiles: 1,
    maxFileSize: 100 * MB,
    warnFileSize: 30 * MB,
  },
  warm() {
    void loadPdfjs();
  },
  previewFile: (file) => previewPdfFile(file, THUMBNAIL_WIDTH),
  async run({ files }, _options, { signal, onProgress }) {
    const opened = [];
    let total = 0;
    let done = 0;
    const outputs: { name: string; bytes: Uint8Array; source: string; hasText: boolean }[] = [];
    try {
      for (const file of files) {
        try {
          const doc = await openWithFonts(file);
          opened.push({ file, doc });
          total += doc.doc.numPages;
        } catch (error) {
          throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
        }
        if (opened[opened.length - 1].doc.doc.numPages > MAX_PAGES) throw new ToolError(fill(t.tooManyPages, { name: file.name, max: MAX_PAGES }));
      }
      for (const { file, doc } of opened) {
        const pages: PageLayout[] = [];
        const pictures = new Map<string, PictureFile>();
        let hasText = false;
        for (let number = 1; number <= doc.doc.numPages; number++) {
          if (signal.aborted) throw signal.reason;
          const page = await doc.doc.getPage(number);
          try {
            const content = await readPageContent(page);
            hasText ||= content.pieces.some((piece) => piece.text.trim());
            const layout = layoutPage(content);
            const places = [...layout.behind, ...layout.blocks.flatMap((block) => (block.kind === "picture" ? [block.place] : []))];
            for (const place of places) {
              if (pictures.has(place.key)) continue;
              const picture = await place.draw(place.width * PICTURE_DENSITY);
              if (picture) pictures.set(place.key, picture);
            }
            pages.push(layout);
          } finally {
            page.cleanup();
          }
          onProgress(++done / (total + 1));
        }
        const title = file.name.replace(/\.pdf$/i, "");
        outputs.push({ name: wordName(file.name), bytes: buildDocx(pages, pictures, title), source: file.name, hasText });
      }
    } finally {
      opened.forEach(({ doc }) => doc.close());
    }
    const scans = outputs.filter((output) => !output.hasText).length;
    const hint = scans ? ` ${outputs.length === 1 ? t.scanHintOne : fill(t.scanHintMany, { count: scans })}` : "";
    const blobs = outputs.map((output) => new Blob([output.bytes as BlobPart], { type: DOCX }));
    onProgress(1);
    if (outputs.length === 1) {
      return {
        files: [{ name: outputs[0].name, blob: blobs[0] }],
        summary: fill(t.summaryOne, { name: outputs[0].source, output: outputs[0].name, size: formatSize(blobs[0].size) }) + hint,
      };
    }
    const zip = new Blob([zipParts(outputs.map((output) => ({ name: output.name, bytes: output.bytes }))) as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: outputs.map((output, index) => ({ name: output.name, blob: blobs[index], label: fill(t.part, { name: output.source }) })),
      summary: fill(t.summaryMany, { count: outputs.length, size: formatSize(zip.size) }) + hint,
    };
  },
};
