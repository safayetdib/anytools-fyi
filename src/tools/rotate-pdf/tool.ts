import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { quarterTurns } from "./rotate";
import type { RotateJob, RotateResult } from "./worker";

const t = en.rotatePdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<RotateJob, RotateResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "rotate-pdf" }),
);

// The options panel sends each file's turn, in the file list's order. Anything unreadable counts as no turn.
export function readTurns(options: Record<string, string>, count: number): number[] {
  let turns: unknown = [];
  try {
    turns = JSON.parse(options.rotations ?? "[]");
  } catch {
    // No turns yet.
  }
  const list = Array.isArray(turns) ? turns : [];
  return Array.from({ length: count }, (_, index) => quarterTurns(0, Number(list[index]) || 0));
}

function skipped(names: string[]): string {
  if (!names.length) return "";
  return ` ${names.length === 1 ? fill(t.skippedOne, { name: names[0] }) : fill(t.skippedMany, { count: names.length })}`;
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
    const turns = readTurns(options, files.length);
    // Like a receipt: only the files that were turned are made again.
    const chosen = files.map((file, index) => ({ file, turn: turns[index] })).filter(({ turn }) => turn !== 0);
    if (!chosen.length) throw new ToolError(t.empty);
    const jobs = await Promise.all(chosen.map(async ({ file, turn }) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), turn })));
    let result: RotateResult;
    try {
      result = await runner.run({ op: "rotate", files: jobs }, jobs.map((job) => job.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      const name = jobs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    if (result.op !== "rotate") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    const left = skipped(files.filter((_, index) => turns[index] === 0).map((file) => file.name));
    if (pdfs.length === 1) {
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(t.summaryOne, { name: chosen[0].file.name, output: result.names[0], size: formatSize(pdfs[0].size) }) + left,
      };
    }
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: fill(t.partTurn, { angle: chosen[index].turn }) })),
      summary: fill(t.summaryMany, { count: pdfs.length, size: formatSize(zip.size) }) + left,
    };
  },
};
