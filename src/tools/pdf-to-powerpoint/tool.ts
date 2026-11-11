import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { PdfLocked, openWithFonts, readPageContent } from "../../lib/pdf/page-content";
import { canvasToJpeg, releaseLayers, renderLayers, scanColours, textColour } from "../../lib/pdf/page-render";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { buildPptx, powerpointName, type Slide } from "./pptx";
import { textBoxes } from "./slides";

const t = en.pdfToPowerpoint;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Each slide carries a picture of its page, so very long PDFs would make a file too large for a phone to build.
export const MAX_PAGES = 300;
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
        const slides: Slide[] = [];
        let hasText = false;
        for (let number = 1; number <= doc.doc.numPages; number++) {
          if (signal.aborted) throw signal.reason;
          const page = await doc.doc.getPage(number);
          try {
            const content = await readPageContent(page, { pictures: false });
            const layers = await renderLayers(page);
            try {
              hasText ||= content.pieces.some((piece) => piece.text.trim());
              // Text OCR hid behind a scan goes on top in boxes the paper's colour, covering the scan's picture of it.
              const boxes = content.hiddenText
                ? textBoxes(content, () => "000000", (box) => scanColours(layers, box))
                : textBoxes(content, (box) => textColour(layers, box));
              const picture = await canvasToJpeg(content.hiddenText ? layers.withText : layers.withoutText);
              slides.push({ width: content.width, height: content.height, picture, boxes });
            } finally {
              releaseLayers(layers);
            }
          } finally {
            page.cleanup();
          }
          onProgress(++done / (total + 1));
        }
        const title = file.name.replace(/\.pdf$/i, "");
        outputs.push({ name: powerpointName(file.name), bytes: buildPptx(slides, title), source: file.name, hasText });
      }
    } finally {
      opened.forEach(({ doc }) => doc.close());
    }
    const scans = outputs.filter((output) => !output.hasText).length;
    const hint = scans ? ` ${outputs.length === 1 ? t.scanHintOne : fill(t.scanHintMany, { count: scans })}` : "";
    const blobs = outputs.map((output) => new Blob([output.bytes as BlobPart], { type: PPTX }));
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
