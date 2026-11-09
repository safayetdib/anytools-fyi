import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { pictureOf } from "./mark-store";
import type { Mark } from "./marks";
import { toPng } from "./photo";
import { readPlacements, type SignatureImage } from "./sign";
import type { SignJob, SignResult } from "./worker";

const t = en.signPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<SignJob, SignResult>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "sign-pdf" }),
);

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
    const placements = readPlacements(options.placements ?? "");
    if (!placements.length) throw new ToolError(t.needPlacement);
    // Each placed mark's picture at full size, made once however many pages it goes on.
    const images: Partial<Record<Mark, SignatureImage>> = {};
    for (const mark of new Set(placements.map((place) => place.mark))) {
      const pixels = await pictureOf(mark)?.full();
      if (!pixels) throw new ToolError(t.needMark[mark]);
      images[mark] = { bytes: new Uint8Array(await (await toPng(pixels)).arrayBuffer()), width: pixels.width, height: pixels.height };
    }
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: SignResult;
    try {
      result = await runner.run(
        { op: "sign", name: file.name, bytes, images, placements },
        [bytes.buffer, ...Object.values(images).map((image) => image.bytes.buffer)],
        context,
      );
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "empty") throw new ToolError(t.needPlacement);
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: file.name }));
    }
    if (result.op !== "sign") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const pages = new Set(placements.map((place) => place.page)).size;
    return {
      files: [{ name: result.name, blob }],
      summary: fill(pages === 1 ? t.summaryOne : t.summaryMany, { name: file.name, pages, output: result.name, size: formatSize(blob.size) }),
    };
  },
};
