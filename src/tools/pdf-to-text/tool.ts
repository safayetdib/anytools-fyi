import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { PdfLocked, openWithFonts, readText } from "../../lib/pdf/page-content";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { documentText, hasAnyText, pageText, textName, type Piece } from "./text";

const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

// The words the run shows. PDF to text has its own; Bangla PDF to Unicode brings others, and says when a PDF had no
// Bijoy text to turn into Unicode.
export type TextStrings = Pick<
  typeof en.pdfToText,
  "encrypted" | "unreadable" | "noText" | "noTextMany" | "marker" | "summaryOne" | "summaryMany" | "summarySkipped" | "part" | "zipName" | "bijoyOne" | "bijoyMany"
> & { plainOne?: string; plainMany?: string };

export const TEXT_CONFIG: ToolDefinition["config"] = {
  mode: "files",
  accept: ".pdf,application/pdf",
  acceptLabel: en.pdfToText.acceptLabel,
  arrangeHint: en.pdfToText.arrangeHint,
  multiple: true,
  orderMatters: false,
  minFiles: 1,
  maxFileSize: 100 * MB,
  warnFileSize: 30 * MB,
};

export function textTool(t: TextStrings, config: ToolDefinition["config"] = TEXT_CONFIG): ToolDefinition {
  return {
    config,
    warm() {
      void loadPdfjs();
    },
    previewFile: (file) => previewPdfFile(file, THUMBNAIL_WIDTH),
    async run({ files }, options, { signal, onProgress }) {
      const markPages = options.markers === "yes";
      const outputs: { name: string; text: string; source: string; bijoy: boolean }[] = [];
      let total = 0;
      let done = 0;
      const opened = [];
      try {
        for (const file of files) {
          try {
            const doc = await openWithFonts(file);
            opened.push({ file, doc });
            total += doc.doc.numPages;
          } catch (error) {
            throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
          }
        }
        for (const { file, doc } of opened) {
          const pages: string[] = [];
          let bijoy = false;
          for (let number = 1; number <= doc.doc.numPages; number++) {
            if (signal.aborted) throw signal.reason;
            const page = await doc.doc.getPage(number);
            try {
              // The fonts' names say which text is set in a Bijoy font, and they come with the drawing steps.
              await page.getOperatorList();
              const { items, bijoyFonts } = await readText(page);
              bijoy ||= bijoyFonts.size > 0;
              const pieces: Piece[] = items.map((item) => ({ str: item.str ?? "", hasEOL: !!item.hasEOL, y: item.transform[5], size: item.height || Math.abs(item.transform[3]) || 10 }));
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
          outputs.push({ name: textName(file.name), text: documentText(pages, markPages ? (page) => fill(t.marker, { page }) : null), source: file.name, bijoy });
        }
      } finally {
        opened.forEach(({ doc }) => doc.close());
      }
      if (!outputs.length) throw new ToolError(t.noTextMany);
      const converted = outputs.filter((output) => output.bijoy).length;
      const plain = outputs.length - converted;
      const one = outputs.length === 1;
      const hint = [converted && (one ? t.bijoyOne : fill(t.bijoyMany, { count: converted })), plain && t.plainMany && (one ? t.plainOne : fill(t.plainMany, { count: plain }))]
        .filter(Boolean)
        .map((text) => ` ${text}`)
        .join("");
      const encoder = new TextEncoder();
      const blobs = outputs.map((output) => new Blob([output.text], { type: "text/plain;charset=utf-8" }));
      if (one) {
        // The text shows under the result too, to read or copy without opening the file.
        return {
          files: [{ name: outputs[0].name, blob: blobs[0] }],
          text: outputs[0].text,
          summary: fill(t.summaryOne, { name: outputs[0].source, output: outputs[0].name, size: formatSize(blobs[0].size) }) + hint,
        };
      }
      const zip = new Blob([zipParts(outputs.map((output) => ({ name: output.name, bytes: encoder.encode(output.text) }))) as BlobPart], { type: "application/zip" });
      onProgress(1);
      const skipped = files.length - outputs.length;
      return {
        files: [{ name: t.zipName, blob: zip }],
        parts: outputs.map((output, index) => ({ name: output.name, blob: blobs[index], label: fill(t.part, { name: output.source }) })),
        summary: fill(skipped ? t.summarySkipped : t.summaryMany, { count: outputs.length, skipped, size: formatSize(zip.size) }) + hint,
      };
    },
  };
}

export const tool = textTool(en.pdfToText);
