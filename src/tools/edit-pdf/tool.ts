import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { canDraw } from "../../lib/pdf/stamp";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { readEdits, type LinePicture } from "./edit";
import { allImages } from "./image-store";
import type { EditJob, EditResult } from "./worker";

const t = en.editPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<EditJob, EditResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "edit-pdf" }));

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
  async run({ files }, options, context) {
    const edits = readEdits(options.edits ?? "");
    if (!edits.length) throw new ToolError(t.needEdit);
    // Text the built-in fonts can't draw, such as Bangla, is drawn here in the page, one picture per line.
    const pictures: Record<number, LinePicture[]> = {};
    for (const [index, edit] of edits.entries()) {
      if (edit.kind !== "text" || canDraw(edit.text.replace(/\n/g, ""))) continue;
      const { textPicture } = await import("../../lib/pdf/text-picture");
      pictures[index] = await Promise.all(
        edit.text.split("\n").map(async (line) => ({ ...(await textPicture(line || " ", edit)), kind: "png" as const })),
      );
    }
    const images = allImages();
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: EditResult;
    try {
      // The pictures stay with the panel for more edits, so they're copied rather than handed over.
      result = await runner.run({ op: "edit", name: file.name, bytes, edits, images, pictures }, [bytes.buffer], context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "empty") throw new ToolError(t.needEdit);
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: file.name }));
    }
    if (result.op !== "edit") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    const pages = new Set(edits.map((edit) => edit.page)).size;
    return {
      files: [{ name: result.name, blob }],
      summary: fill(pages === 1 ? t.summaryOne : t.summaryMany, { name: file.name, changes: edits.length === 1 ? t.changeOne : fill(t.changeMany, { count: edits.length }), pages, output: result.name, size: formatSize(blob.size) }),
    };
  },
};
