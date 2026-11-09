import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { hasCrop, readPlan } from "./crop";
import type { CropJob, CropResult } from "./worker";

const t = en.cropPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<CropJob, CropResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "crop-pdf" }));

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
    const plan = readPlan(options.crop ?? "");
    if (!hasCrop(plan)) throw new ToolError(t.needCrop);
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: CropResult;
    try {
      result = await runner.run({ op: "crop", name: file.name, bytes, plan }, [bytes.buffer], context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "empty") throw new ToolError(t.needCrop);
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: file.name }));
    }
    if (result.op !== "crop") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const summary = plan.all
      ? fill(t.summaryAll, { output: result.name, size: formatSize(blob.size) })
      : fill(plan.pages.length === 1 ? t.summaryOne : t.summaryMany, { count: plan.pages.length, output: result.name, size: formatSize(blob.size) });
    return { files: [{ name: result.name, blob }], summary };
  },
};
