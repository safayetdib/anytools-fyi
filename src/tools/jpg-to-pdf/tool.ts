import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { createWorkerRunner } from "../../lib/worker/client";
import { readScanFilter } from "../scan-to-pdf/enhance";
import { imageThumbnail, prepareImage, prepareScan } from "./images";
import { pdfName, readSettings, type PreparedImage } from "./layout";
import type { ImagesJob, ImagesResult } from "./worker";

const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<ImagesJob, ImagesResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "jpg-to-pdf" }),
);

// Each image's turn, from the cards, in the file list's order.
export function readTurns(text: string, count: number): number[] {
  let raw: unknown;
  try {
    raw = (JSON.parse(text) as { rotations?: unknown }).rotations;
  } catch {
    raw = [];
  }
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: count }, (_, index) => {
    const turn = Number(list[index]);
    return [0, 90, 180, 270].includes(turn) ? turn : 0;
  });
}

// The look chosen for scans, from the options.
function readFilter(text: string) {
  try {
    return readScanFilter((JSON.parse(text) as { filter?: unknown }).filter);
  } catch {
    return readScanFilter(undefined);
  }
}

// JPG to PDF, and Scan to PDF: the same tool, where scans are cleaned to look like scanned paper first.
export function imagesTool(scan: boolean): ToolDefinition {
  const t = scan ? { ...en.jpgToPdf, ...en.scanToPdf } : en.jpgToPdf;
  return {
    config: {
      mode: "files",
      accept: ".jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,image/jpeg,image/png,image/webp,image/gif,image/bmp,image/heic,image/heif",
      acceptLabel: t.acceptLabel,
      arrangeHint: t.arrangeHint,
      multiple: true,
      minFiles: 1,
      maxFileSize: 50 * MB,
      warnFileSize: 20 * MB,
    },
    warm() {
      runner.warm();
      void loadPdfjs();
    },
    async previewFile(file) {
      try {
        return { status: "ready", image: (await imageThumbnail(file, THUMBNAIL_WIDTH)).image };
      } catch {
        return { status: "unreadable" };
      }
    },
    previewOutput: previewPdfOutput,
    async rearrangeOutput(file, plan, context) {
      const source = new Uint8Array(await file.blob.arrayBuffer());
      const result = await runner.run({ op: "rearrange", bytes: source, plan }, [source.buffer], context);
      if (result.op !== "rearrange") throw new Error("Unexpected result");
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      return {
        files: [{ name: file.name, blob }],
        summary: fill(t.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
      };
    },
    async run({ files }, options, context) {
      const settings = readSettings(options.layout ?? "");
      const turns = readTurns(options.layout ?? "", files.length);
      const filter = scan ? readFilter(options.layout ?? "") : "original";
      const images: PreparedImage[] = [];
      for (const [index, file] of files.entries()) {
        try {
          images.push(scan ? await prepareScan(file, turns[index], filter) : await prepareImage(file, turns[index]));
          context.onProgress(((index + 1) / files.length) * 0.5);
        } catch {
          throw new ToolError(fill(t.unreadable, { name: file.name }));
        }
      }
      const merged = settings.merge || files.length === 1;
      const names = merged ? [pdfName(files[0].name)] : files.map((file) => pdfName(file.name));
      let result: ImagesResult;
      try {
        result = await runner.run({ op: "build", images, names, settings: { ...settings, merge: merged } }, images.map((image) => image.bytes.buffer), context);
      } catch (error) {
        // pdf-lib refuses images it can't read, such as a damaged JPG.
        if (error instanceof Error && error.name !== "AbortError") throw new ToolError(fill(t.unreadable, { name: files[0].name }));
        throw error;
      }
      if (result.op !== "build") throw new Error("Unexpected result");
      const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
      if (pdfs.length === 1) {
        const size = formatSize(pdfs[0].size);
        return {
          files: [{ name: names[0], blob: pdfs[0] }],
          summary:
            files.length === 1
              ? fill(t.summaryOneImage, { name: files[0].name, output: names[0], size })
              : fill(t.summaryOne, { count: files.length, output: names[0], size }),
        };
      }
      const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
      return {
        files: [{ name: t.zipName, blob: zip }],
        parts: pdfs.map((blob, index) => ({ name: names[index], blob, label: fill(t.partLabel, { name: files[index].name }) })),
        summary: fill(t.summaryMany, { count: pdfs.length, size: formatSize(zip.size) }),
      };
    },
  };
}

export const tool = imagesTool(false);
