import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { chosenSignature, cleaned, toPng } from "./chosen-signature";
import { readClean } from "./clean";
import { readPlacements } from "./sign";
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
    if (!chosenSignature()) throw new ToolError(t.needSignature);
    const placements = readPlacements(options.placements ?? "");
    if (!placements.length) throw new ToolError(t.needPlacement);
    const signature = cleaned(readClean(options.clean ?? ""), "full");
    if (!signature) throw new ToolError(t.noInk);
    const png = new Uint8Array(await (await toPng(signature)).arrayBuffer());
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: SignResult;
    try {
      result = await runner.run(
        { op: "sign", name: file.name, bytes, image: { bytes: png, width: signature.width, height: signature.height }, placements },
        [bytes.buffer, png.buffer],
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
