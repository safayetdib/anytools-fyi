import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { removedName } from "./remove";
import type { RemoveJob, RemoveResult } from "./worker";

const t = en.removePdfPages;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<RemoveJob, RemoveResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "remove-pdf-pages" }),
);

function failure(code: string, fileName: string): ToolError {
  if (code === "encrypted") return new ToolError(fill(t.encrypted, { name: fileName }));
  if (code === "all") return new ToolError(t.allError);
  if (code === "empty") return new ToolError(t.empty);
  return new ToolError(fill(t.unreadable, { name: fileName }));
}

function summary(removed: number, name: string, output: string, pages: number, size: string): string {
  if (removed === 1) return fill(t.summaryOne, { name, output, pages, size });
  if (pages === 1) return fill(t.summaryLeftOne, { removed, name, output, size });
  return fill(t.summary, { removed, name, output, pages, size });
}

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: false,
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
      summary: fill(t.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, options, context) {
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: RemoveResult;
    try {
      result = await runner.run({ op: "remove", bytes, pages: options.pages ?? "" }, [bytes.buffer], context);
    } catch (error) {
      if (error instanceof WorkerJobFailed) throw failure(error.code, file.name);
      throw error;
    }
    if (result.op !== "remove") throw new Error("Unexpected result");
    const output = removedName(file.name);
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    return {
      files: [{ name: output, blob }],
      summary: summary(result.removed, file.name, output, result.pageCount, formatSize(blob.size)),
    };
  },
};
