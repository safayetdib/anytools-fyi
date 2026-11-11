import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { PdfLocked, openPdf } from "../pdf-to-jpg/render";
import { documentText, hasAnyText, pageText, textName, type Piece } from "./text";

const t = en.pdfToText;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

interface TextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  height: number;
}

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
  async run({ files }, options, { signal, onProgress }) {
    const markPages = options.markers === "yes";
    const outputs: { name: string; text: string; source: string }[] = [];
    let total = 0;
    let done = 0;
    const opened = [];
    try {
      for (const file of files) {
        try {
          const doc = await openPdf(file);
          opened.push({ file, doc });
          total += doc.doc.numPages;
        } catch (error) {
          throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
        }
      }
      for (const { file, doc } of opened) {
        const pages: string[] = [];
        for (let number = 1; number <= doc.doc.numPages; number++) {
          if (signal.aborted) throw signal.reason;
          const page = await doc.doc.getPage(number);
          try {
            const { items } = await page.getTextContent();
            const pieces: Piece[] = (items as TextItem[])
              .filter((item) => typeof item.str === "string")
              .map((item) => ({ str: item.str, hasEOL: item.hasEOL, y: item.transform[5], size: item.height || Math.abs(item.transform[3]) || 10 }));
            pages.push(pageText(pieces));
          } finally {
            page.cleanup();
          }
          onProgress(++done / (total + 1));
        }
        if (!hasAnyText(pages)) {
          if (files.length === 1) throw new ToolError(fill(t.noText, { name: file.name }));
          continue;
        }
        outputs.push({ name: textName(file.name), text: documentText(pages, markPages ? (page) => fill(t.marker, { page }) : null), source: file.name });
      }
    } finally {
      opened.forEach(({ doc }) => doc.close());
    }
    if (!outputs.length) throw new ToolError(t.noTextMany);
    const encoder = new TextEncoder();
    const blobs = outputs.map((output) => new Blob([output.text], { type: "text/plain;charset=utf-8" }));
    if (outputs.length === 1) {
      // The text shows under the result too, to read or copy without opening the file.
      return {
        files: [{ name: outputs[0].name, blob: blobs[0] }],
        text: outputs[0].text,
        summary: fill(t.summaryOne, { name: outputs[0].source, output: outputs[0].name, size: formatSize(blobs[0].size) }),
      };
    }
    const zip = new Blob([zipParts(outputs.map((output) => ({ name: output.name, bytes: encoder.encode(output.text) }))) as BlobPart], { type: "application/zip" });
    onProgress(1);
    const skipped = files.length - outputs.length;
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: outputs.map((output, index) => ({ name: output.name, blob: blobs[index], label: fill(t.part, { name: output.source }) })),
      summary: fill(skipped ? t.summarySkipped : t.summaryMany, { count: outputs.length, skipped, size: formatSize(zip.size) }),
    };
  },
};
