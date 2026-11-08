import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { readPlan } from "./organize";
import type { OrganizeJob } from "./worker";

const t = en.organizePdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<OrganizeJob, { bytes: Uint8Array; pageCount: number }>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "organize-pdf" }),
);

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // The grid sets the page order, so the file list's order only decides where new pages start.
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
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    return {
      files: [{ name: file.name, blob }],
      summary: fill(t.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, options, context) {
    const plan = readPlan(options.plan ?? "", files.length);
    if (!plan.length) throw new ToolError(t.empty);
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    let result: { bytes: Uint8Array; pageCount: number };
    try {
      result = await runner.run({ op: "organize", files: inputs, plan }, inputs.map((input) => input.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "empty") throw new ToolError(t.empty);
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: error.detail ?? "" }));
    }
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const size = formatSize(blob.size);
    return {
      files: [{ name: t.outputName, blob }],
      summary: result.pageCount === 1 ? fill(t.summaryOne, { size }) : fill(t.summary, { pages: result.pageCount, size }),
    };
  },
};
