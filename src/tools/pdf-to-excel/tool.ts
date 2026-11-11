import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { PdfLocked, openWithFonts, readPageContent } from "../../lib/pdf/page-content";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { buildGrid, type Grid } from "./table";
import { buildXlsx, excelName, type Sheet } from "./xlsx";

const t = en.pdfToExcel;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Excel allows at most this many sheets in practice before it slows down badly.
export const MAX_PAGES = 500;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Pages one after another on a single sheet, with an empty row between them.
export function joinGrids(grids: Grid[]): Grid {
  const rows = grids.flatMap((grid, index) => (index ? [[], ...grid.rows] : grid.rows));
  const count = Math.max(0, ...grids.map((grid) => grid.widths.length));
  const widths = Array.from({ length: count }, (_, c) => Math.max(0, ...grids.map((grid) => grid.widths[c] ?? 0)));
  return { rows, widths };
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
    const oneSheet = options.sheets === "one";
    const opened = [];
    let total = 0;
    let done = 0;
    const outputs: { name: string; bytes: Uint8Array; source: string }[] = [];
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
        const grids: Grid[] = [];
        let hasText = false;
        for (let number = 1; number <= doc.doc.numPages; number++) {
          if (signal.aborted) throw signal.reason;
          const page = await doc.doc.getPage(number);
          try {
            const content = await readPageContent(page, { pictures: false });
            hasText ||= content.pieces.some((piece) => piece.text.trim());
            grids.push(buildGrid(content.pieces));
          } finally {
            page.cleanup();
          }
          onProgress(++done / (total + 1));
        }
        if (!hasText) {
          if (files.length === 1) throw new ToolError(fill(t.noText, { name: file.name }));
          continue;
        }
        const sheets: Sheet[] = oneSheet ? [{ name: t.sheetAll, grid: joinGrids(grids) }] : grids.map((grid, index) => ({ name: fill(t.sheetName, { page: index + 1 }), grid }));
        outputs.push({ name: excelName(file.name), bytes: buildXlsx(sheets, file.name.replace(/\.pdf$/i, "")), source: file.name });
      }
    } finally {
      opened.forEach(({ doc }) => doc.close());
    }
    if (!outputs.length) throw new ToolError(t.noTextMany);
    const blobs = outputs.map((output) => new Blob([output.bytes as BlobPart], { type: XLSX }));
    onProgress(1);
    if (outputs.length === 1) {
      return {
        files: [{ name: outputs[0].name, blob: blobs[0] }],
        summary: fill(t.summaryOne, { name: outputs[0].source, output: outputs[0].name, size: formatSize(blobs[0].size) }),
      };
    }
    const zip = new Blob([zipParts(outputs.map((output) => ({ name: output.name, bytes: output.bytes }))) as BlobPart], { type: "application/zip" });
    const skipped = files.length - outputs.length;
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: outputs.map((output, index) => ({ name: output.name, blob: blobs[index], label: fill(t.part, { name: output.source }) })),
      summary: fill(skipped ? t.summarySkipped : t.summaryMany, { count: outputs.length, skipped, size: formatSize(zip.size) }),
    };
  },
};
