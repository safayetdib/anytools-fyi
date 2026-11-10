import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { PdfLocked, openPdf } from "../pdf-to-jpg/render";
import { diffWords } from "./compare";
import type { CompareJob, CompareResult } from "./worker";
import { wordsOf } from "./words";

const t = en.comparePdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Reading the words is most of the work; drawing the pages side by side is the rest.
const READING = 0.6;

const runner = createWorkerRunner<CompareJob, CompareResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "compare-pdf" }));

const countOf = (count: number) => (count === 1 ? t.wordOne : fill(t.wordMany, { count }));

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
  async run({ files }, _options, { signal, onProgress }) {
    if (files.length !== 2) throw new ToolError(t.needTwo);
    const [first, second] = files;
    const words = [];
    for (const [index, file] of files.entries()) {
      let opened: Awaited<ReturnType<typeof openPdf>>;
      try {
        opened = await openPdf(file);
      } catch (error) {
        throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
      }
      try {
        words.push(await wordsOf(opened.doc));
      } finally {
        opened.close();
      }
      if (signal.aborted) throw signal.reason;
      onProgress(((index + 1) / 2) * READING);
    }
    const [before, after] = words;
    if (!before.length && !after.length) throw new ToolError(t.noText);
    const { removed, added } = diffWords(
      before.map((word) => word.text),
      after.map((word) => word.text),
    );
    const job: CompareJob = {
      op: "compare",
      before: { name: first.name, bytes: new Uint8Array(await first.arrayBuffer()), removed: removed.map((index) => before[index]) },
      after: { name: second.name, bytes: new Uint8Array(await second.arrayBuffer()), added: added.map((index) => after[index]) },
      labels: { before: t.originalLabel, after: t.changedLabel },
    };
    let result: CompareResult;
    try {
      result = await runner.run(job, [job.before.bytes.buffer as ArrayBuffer, job.after.bytes.buffer as ArrayBuffer], {
        signal,
        onProgress: (fraction) => onProgress(READING + (fraction ?? 0) * (1 - READING)),
      });
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      const name = error.detail === "after" ? second.name : first.name;
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const values = { removed: countOf(removed.length), added: countOf(added.length), output: result.name, size: formatSize(blob.size) };
    return {
      files: [{ name: result.name, blob }],
      summary: fill(removed.length || added.length ? t.summary : t.summarySame, values),
    };
  },
};
