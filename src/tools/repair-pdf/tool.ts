import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { RepairJob, RepairResult } from "./worker";

const t = en.repairPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<RepairJob, RepairResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "repair-pdf" }));

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is repaired on its own, so their order doesn't matter.
    orderMatters: false,
    minFiles: 1,
    maxFileSize: 100 * MB,
    warnFileSize: 30 * MB,
  },
  warm() {
    runner.warm();
    void loadPdfjs();
  },
  // Damaged files are what this tool is for, so they aren't flagged as a problem in the list. The cards say what's wrong.
  async previewFile(file) {
    const preview = await previewPdfFile(file, THUMBNAIL_WIDTH);
    return preview.status === "unreadable" ? { status: "ready" } : preview;
  },
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
    let result: RepairResult;
    try {
      result = await runner.run({ op: "repair", files: inputs }, inputs.map((input) => input.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      const name = inputs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "locked" ? t.locked : t.unreadable, { name }));
    }
    if (result.op !== "repair") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    if (pdfs.length === 1) {
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(result.fixed[0] ? t.summaryFixed : t.summaryClean, { name: files[0].name, output: result.names[0], size: formatSize(pdfs[0].size) }),
      };
    }
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: fill(result.fixed[index] ? t.partFixed : t.partClean, { name: files[index].name }) })),
      summary: fill(t.summaryMany, { fixed: result.fixed.filter(Boolean).length, count: pdfs.length, size: formatSize(zip.size) }),
    };
  },
};
