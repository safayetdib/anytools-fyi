import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { MAX_PARTS, compressPages, type SplitRequest } from "./plan";
import type { SplitJob, SplitResult } from "./worker";

const t = en.splitPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Smaller limits can't hold even a simple page, so they'd only make one file per page.
export const MIN_SIZE_BYTES = 10 * 1024;

const runner = createWorkerRunner<SplitJob, SplitResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "split-pdf" }),
);

// "Page 4", or "Pages 1–3, 7" for longer or merged parts.
export function partLabel(pages: number[]): string {
  if (pages.length === 1) return fill(t.partPage, { page: pages[0] });
  const runs = compressPages(pages).map(({ from, to }) => (from === to ? String(from) : `${from}–${to}`));
  return fill(t.partPages, { pages: runs.join(", ") });
}

// "reason|range|pages" from the plan, as a message that says what to fix.
export function rangeMessage(detail = ""): string {
  const [reason, range, pages] = detail.split("|");
  const template = t.rangeErrors[reason as keyof typeof t.rangeErrors] ?? t.rangeErrors.invalid;
  return fill(template, { range: range ?? "", pages: pages ?? "", max: MAX_PARTS });
}

// The options panel sends its choice as JSON. Anything unexpected falls back to one file per page.
export function readRequest(options: Record<string, string>): SplitRequest {
  try {
    const value = JSON.parse(options.split ?? "") as SplitRequest;
    if (value.mode === "ranges" && Array.isArray(value.ranges)) {
      return { mode: "ranges", ranges: value.ranges.map(({ from, to }) => ({ from: Number(from), to: Number(to) })), merge: Boolean(value.merge) };
    }
    if (value.mode === "fixed") return { mode: "fixed", size: Math.max(1, Math.floor(Number(value.size)) || 1) };
    if (value.mode === "select") return { mode: "select", pages: String(value.pages ?? ""), merge: Boolean(value.merge) };
    if (value.mode === "size") return { mode: "size", maxBytes: Number(value.maxBytes) || 0 };
  } catch {
    // No choice yet: use the default below.
  }
  return { mode: "all" };
}

function failure(error: WorkerJobFailed, request: SplitRequest, fileName: string): ToolError {
  if (error.code !== "range") return new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: fileName }));
  const [reason, range, pages] = (error.detail ?? "").split("|");
  // Custom ranges point at a row ("Range 2"); typed page lists quote what was typed.
  if (request.mode === "ranges" && reason in t.rowErrors) {
    return new ToolError(fill(t.rowErrors[reason as keyof typeof t.rowErrors], { number: range, pages }));
  }
  return new ToolError(rangeMessage(error.detail));
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
    const request = readRequest(options);
    if (request.mode === "size" && request.maxBytes < MIN_SIZE_BYTES) throw new ToolError(t.sizeError);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: SplitResult;
    try {
      result = await runner.run({ op: "split", bytes, name: file.name, request }, [bytes.buffer], context);
    } catch (error) {
      if (error instanceof WorkerJobFailed) throw failure(error, request, file.name);
      throw error;
    }
    if (result.op !== "split") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    const oversize = result.oversize === 0 ? "" : ` ${result.oversize === 1 ? t.oversizeOne : fill(t.oversize, { count: result.oversize })}`;

    // One file works like Merge PDF's result, with the page preview and editing.
    if (pdfs.length === 1) {
      const pages = result.outputs[0].length;
      const template = pages === 1 ? t.summaryOnePage : t.summaryOne;
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(template, { pages, name: file.name, output: result.names[0], size: formatSize(pdfs[0].size) }) + oversize,
      };
    }
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    const base = file.name.replace(/\.pdf$/i, "") || "document";
    return {
      files: [{ name: fill(t.zipName, { name: base }), blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: partLabel(result.outputs[index]) })),
      summary: fill(t.summaryMany, { name: file.name, count: pdfs.length, size: formatSize(zip.size) }) + oversize,
    };
  },
};
