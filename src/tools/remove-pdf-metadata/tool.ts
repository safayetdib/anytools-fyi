import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { Detail } from "./metadata";
import type { MetadataJob, MetadataResult } from "./worker";

const t = en.removePdfMetadata;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<MetadataJob, MetadataResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "remove-pdf-metadata" }));

// "the title, the author and the dates".
export function detailList(details: Detail[]): string {
  const names = details.map((detail) => t.details[detail]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")}${t.and}${names[names.length - 1]}` : (names[0] ?? "");
}

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is cleaned on its own, so their order doesn't matter.
    orderMatters: false,
    minFiles: 1,
    maxFileSize: 100 * MB,
    warnFileSize: 30 * MB,
  },
  warm() {
    runner.warm();
    void loadPdfjs();
  },
  previewFile: (file) => previewPdfFile(file, THUMBNAIL_WIDTH),
  previewOutput: previewPdfOutput,
  async rearrangeOutput(file, plan, context) {
    const source = new Uint8Array(await file.blob.arrayBuffer());
    const result = await runner.run({ op: "rearrange", bytes: source, plan }, [source.buffer], context);
    if (result.op !== "rearrange") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    return {
      files: [{ name: file.name, blob }],
      summary: fill(en.signPdf.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, _options, context) {
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    let result: MetadataResult;
    try {
      result = await runner.run({ op: "clean", files: inputs }, inputs.map((input) => input.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      const name = inputs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    if (result.op !== "clean") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    if (pdfs.length === 1) {
      const removed = result.removed[0];
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(removed.length ? t.summaryOne : t.summaryNone, { name: files[0].name, list: detailList(removed), output: result.names[0], size: formatSize(pdfs[0].size) }),
      };
    }
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: fill(t.part, { name: files[index].name }) })),
      summary: fill(t.summaryMany, { count: pdfs.length, size: formatSize(zip.size) }),
    };
  },
};
