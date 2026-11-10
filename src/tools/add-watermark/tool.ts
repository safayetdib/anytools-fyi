import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { canDraw, type TextPicture } from "../../lib/pdf/stamp";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { chosenImage } from "./chosen-image";
import { readSettings } from "./watermark";
import type { WatermarkJob, WatermarkResult } from "./worker";

const t = en.addWatermark;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<WatermarkJob, WatermarkResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "add-watermark" }),
);

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is stamped on its own, so their order doesn't matter.
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
    const settings = readSettings(options.watermark ?? "");
    const picked = chosenImage();
    if (settings.kind === "image" && !picked) throw new ToolError(t.needImage);
    if (settings.kind === "text" && !settings.text.trim()) throw new ToolError(t.emptyText);
    // The image is copied for the worker, so it can be used again after this run.
    const image = settings.kind === "image" && picked ? { bytes: picked.bytes.slice(), kind: picked.kind } : undefined;
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    // Bangla, and other text the built-in PDF fonts can't draw, is drawn here, where the browser joins its letters.
    let picture: TextPicture | undefined;
    if (settings.kind === "text" && !canDraw(settings.text)) {
      const { textPicture } = await import("../../lib/pdf/text-picture");
      picture = await textPicture(settings.text, settings);
    }
    let result: WatermarkResult;
    try {
      result = await runner.run(
        { op: "stamp", files: inputs, settings, image, picture },
        [...inputs.map((input) => input.bytes.buffer), ...(picture ? [picture.bytes.buffer] : [])],
        context,
      );
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "text") throw new ToolError(t.textError);
      if (error.code === "image") throw new ToolError(t.needImage);
      const name = inputs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    if (result.op !== "stamp") throw new Error("Unexpected result");
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    if (pdfs.length === 1) {
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(t.summaryOne, { name: files[0].name, output: result.names[0], size: formatSize(pdfs[0].size) }),
      };
    }
    const zip = new Blob([result.zip as BlobPart], { type: "application/zip" });
    return {
      files: [{ name: t.zipName, blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: fill(t.partLabel, { name: files[index].name }) })),
      summary: fill(t.summaryMany, { count: pdfs.length, size: formatSize(zip.size) }),
    };
  },
};
