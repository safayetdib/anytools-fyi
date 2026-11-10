import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { PdfLocked, openPdf } from "../pdf-to-jpg/render";
import { MAX_PAGES, hasText, readLanguages } from "./ocr";
import { openReader, readingScale, type Reader } from "./reader";
import type { OcrJob, OcrResult } from "./worker";

const t = en.ocrPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Shares of the progress bar: starting the reader (the first time, downloading it), reading pages, then writing.
const SETUP = 0.1;
const READING = 0.85;

const runner = createWorkerRunner<OcrJob, OcrResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "ocr-pdf" }));

function stopIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}

// The reader can't be interrupted mid-page, so a cancel stops waiting for it at once.
function unlessCancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

const pagesText = (count: number) => (count === 1 ? t.pageOne : fill(t.pageMany, { count }));

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is read on its own, so their order doesn't matter.
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
      summary: fill(en.signPdf.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, options, context) {
    const { signal, onProgress } = context;
    const languages = readLanguages(options.languages ?? "");
    const opened: { file: File; doc: Awaited<ReturnType<typeof openPdf>> }[] = [];
    // Started only when some page needs reading. A cancel while it starts still closes it once it's up.
    let opening: Promise<Reader> | null = null;
    let reader: Reader | null = null;
    try {
      for (const file of files) {
        try {
          opened.push({ file, doc: await openPdf(file) });
        } catch (error) {
          throw new ToolError(fill(error instanceof PdfLocked ? t.locked : t.unreadable, { name: file.name }));
        }
      }
      const total = opened.reduce((sum, { doc }) => sum + doc.doc.numPages, 0);
      if (total > MAX_PAGES) throw new ToolError(fill(t.tooMany, { max: MAX_PAGES }));

      // Pages that already have text are left as they are, so nothing is read twice.
      const plans = [];
      for (const { file, doc } of opened) {
        const pages: number[] = [];
        for (let number = 1; number <= doc.doc.numPages; number++) {
          stopIfCancelled(signal);
          const page = await doc.doc.getPage(number);
          const { items } = await page.getTextContent();
          if (!hasText(items.map((item) => ("str" in item ? item.str : "")).join(" "))) pages.push(number);
          page.cleanup();
        }
        plans.push({ file, doc, pages, layers: [] as { page: number; layer: Uint8Array }[], found: false });
      }

      const toRead = plans.reduce((sum, plan) => sum + plan.pages.length, 0);
      if (toRead) {
        opening = openReader(languages, (fraction) => onProgress(fraction * SETUP));
        reader = await unlessCancelled(opening, signal);
      }
      let done = 0;
      for (const plan of plans) {
        for (const number of plan.pages) {
          stopIfCancelled(signal);
          const page = await plan.doc.doc.getPage(number);
          const base = page.getViewport({ scale: 1 });
          // Drawn as the PDF shows it, so turned pages are read the right way up.
          const viewport = page.getViewport({ scale: readingScale(base.width, base.height) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          try {
            await page.render({ canvas, viewport, background: "#ffffff" }).promise;
            const progress = (fraction: number) => onProgress(SETUP + ((done + fraction) / toRead) * READING);
            const { layer, text } = await unlessCancelled((reader as Reader).read(canvas, progress), signal);
            plan.layers.push({ page: number, layer });
            plan.found ||= text.trim().length > 0;
          } finally {
            canvas.width = canvas.height = 0;
            page.cleanup();
          }
          onProgress(SETUP + (++done / toRead) * READING);
        }
      }

      const inputs = await Promise.all(
        plans.map(async ({ file, layers }) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), layers })),
      );
      const transfer = inputs.flatMap((input) => [input.bytes.buffer as ArrayBuffer, ...input.layers.map(({ layer }) => layer.buffer as ArrayBuffer)]);
      let result: OcrResult;
      try {
        result = await runner.run({ op: "ocr", files: inputs }, transfer, {
          signal,
          onProgress: (fraction) => onProgress(SETUP + READING + (fraction ?? 0) * (1 - SETUP - READING)),
        });
      } catch (error) {
        if (!(error instanceof WorkerJobFailed)) throw error;
        const name = files[Number(error.detail)]?.name ?? "";
        throw new ToolError(fill(error.code === "encrypted" ? t.locked : t.unreadable, { name }));
      }
      if (result.op !== "ocr") throw new Error("Unexpected result");

      const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
      // What happened to each file, in a few words.
      const outcomes = plans.map((plan) => {
        const skipped = plan.doc.doc.numPages - plan.pages.length;
        if (!plan.pages.length) return { kind: "hadText" as const, skipped };
        return { kind: plan.found ? ("read" as const) : ("nothing" as const), skipped };
      });
      if (pdfs.length === 1) {
        const [outcome] = outcomes;
        const values = { name: files[0].name, output: result.names[0], size: formatSize(pdfs[0].size) };
        const main = fill({ read: t.summaryRead, nothing: t.summaryNothing, hadText: t.summaryHadText }[outcome.kind], values);
        const skipped = outcome.kind !== "hadText" && outcome.skipped ? ` ${fill(t.summarySkipped, { pages: pagesText(outcome.skipped) })}` : "";
        return { files: [{ name: result.names[0], blob: pdfs[0] }], summary: main + skipped };
      }
      const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
      return {
        files: [{ name: t.zipName, blob: zip }],
        parts: pdfs.map((blob, index) => ({
          name: result.names[index],
          blob,
          label: fill({ read: t.partRead, nothing: t.partNothing, hadText: t.partHadText }[outcomes[index].kind], { name: files[index].name }),
        })),
        summary: fill(t.summaryMany, { pages: pagesText(toRead), count: pdfs.length, size: formatSize(zip.size) }),
      };
    } finally {
      opened.forEach(({ doc }) => doc.close());
      opening?.then((started) => started.close()).catch(() => {});
    }
  },
};
