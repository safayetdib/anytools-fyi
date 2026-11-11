import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { PdfLocked, openPdf } from "../pdf-to-jpg/render";
import { paintPage } from "./paint";
import { pagesToRedact, readBoxes, type RedactedPage } from "./redact";
import type { RedactJob, RedactResult } from "./worker";

const t = en.redactPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Drawing the marked pages is most of the work; building the file is the rest.
const PAINTING = 0.85;

const runner = createWorkerRunner<RedactJob, RedactResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "redact-pdf" }));

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
      summary: fill(en.signPdf.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, options, { signal, onProgress }) {
    const boxes = readBoxes(options.boxes ?? "");
    const marked = pagesToRedact(boxes);
    if (!marked.length) throw new ToolError(t.needBox);
    const file = files[0];
    let opened: Awaited<ReturnType<typeof openPdf>>;
    try {
      opened = await openPdf(file);
    } catch (error) {
      throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
    }
    const pages: RedactedPage[] = [];
    try {
      for (const [index, number] of marked.entries()) {
        if (signal.aborted) throw signal.reason;
        if (number > opened.doc.numPages) continue;
        const page = await opened.doc.getPage(number);
        try {
          pages.push(await paintPage(page, boxes.filter((box) => box.page === number)));
        } finally {
          page.cleanup();
        }
        onProgress(((index + 1) / marked.length) * PAINTING);
      }
    } finally {
      opened.close();
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: RedactResult;
    try {
      result = await runner.run({ op: "redact", name: file.name, bytes, pages }, [bytes.buffer, ...pages.map((page) => page.bytes.buffer as ArrayBuffer)], {
        signal,
        onProgress: (fraction) => onProgress(PAINTING + (fraction ?? 0) * (1 - PAINTING)),
      });
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "empty") throw new ToolError(t.needBox);
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: file.name }));
    }
    if (result.op !== "redact") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const areas = boxes.length === 1 ? t.areaOne : fill(t.areaMany, { count: boxes.length });
    const where = pages.length === 1 ? t.pageOne : fill(t.pageMany, { count: pages.length });
    return {
      files: [{ name: result.name, blob }],
      summary: fill(t.summary, { areas, pages: where, name: file.name, output: result.name, size: formatSize(blob.size) }),
    };
  },
};
