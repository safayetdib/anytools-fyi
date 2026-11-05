import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { MergeJob } from "./worker";

const t = en.mergePdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<MergeJob, { bytes: Uint8Array; pageCount: number }>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "merge-pdf" }),
);

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    minFiles: 2,
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
    const { bytes, pageCount } = await runner.run({ op: "rearrange", bytes: source, plan }, [source.buffer], context);
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    return {
      files: [{ name: file.name, blob }],
      summary: fill(t.editedSummary, { name: file.name, pages: pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, _options, context) {
    const inputs = await Promise.all(
      files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
    );
    try {
      const { bytes, pageCount } = await runner.run(
        { op: "merge", files: inputs },
        inputs.map((input) => input.bytes.buffer),
        context,
      );
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      return {
        files: [{ name: t.outputName, blob }],
        summary: fill(t.summary, { count: files.length, pages: pageCount, size: formatSize(blob.size) }),
      };
    } catch (error) {
      if (error instanceof WorkerJobFailed) {
        throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: error.detail ?? "" }));
      }
      throw error;
    }
  },
};
