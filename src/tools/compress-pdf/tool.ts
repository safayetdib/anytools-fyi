import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import type { ToolDefinition } from "../../lib/shell/types";
import { ToolError } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { readLevel } from "./compress";
import type { CompressJob, CompressResult } from "./worker";

const t = en.compressPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<CompressJob, CompressResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "compress-pdf" }),
);

// How much smaller, in whole percent: at least 1% when smaller at all, and never "100%", since something is always left.
export function savedPercent(before: number, after: number): number {
  if (after >= before) return 0;
  return Math.min(99, Math.max(1, Math.round((1 - after / before) * 100)));
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
    const level = readLevel(options.level ?? "");
    const jobs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    let result: CompressResult;
    try {
      result = await runner.run({ op: "compress", files: jobs, level }, jobs.map((job) => job.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      const name = files[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    if (result.op !== "compress") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    if (pdfs.length === 1) {
      const before = result.before[0];
      const after = pdfs[0].size;
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: result.smaller[0]
          ? fill(t.summaryOne, { name: files[0].name, percent: savedPercent(before, after), before: formatSize(before), after: formatSize(after) })
          : fill(t.alreadyOne, { name: files[0].name, size: formatSize(after) }),
      };
    }
    const before = result.before.reduce((sum, size) => sum + size, 0);
    const after = pdfs.reduce((sum, blob) => sum + blob.size, 0);
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: pdfs.map((blob, index) => ({
        name: result.names[index],
        blob,
        label: result.smaller[index] ? fill(t.partSmaller, { percent: savedPercent(result.before[index], blob.size) }) : t.partAlready,
      })),
      summary: result.smaller.some(Boolean)
        ? fill(t.summaryMany, { count: pdfs.length, percent: savedPercent(before, after), before: formatSize(before), after: formatSize(after) })
        : fill(t.alreadyMany, { size: formatSize(zip.size) }),
    };
  },
};
