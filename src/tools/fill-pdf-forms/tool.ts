import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { canDraw } from "../../lib/pdf/stamp";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { LinePicture } from "../edit-pdf/edit";
import { readAnswers, type FormField } from "./forms";
import type { FormJob, FormResult } from "./worker";

const t = en.fillPdfForms;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;
// Flattened Bangla answers are drawn at this size, shrunk to fit their box.
const PICTURE_SIZE = 12;

const runner = createWorkerRunner<FormJob, FormResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "fill-pdf-forms" }));

// The form's fields, for the panel to show on the pages. A file that can't be read has none.
export async function readFields(file: File): Promise<FormField[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const result = await runner.run({ op: "read", bytes }, [bytes.buffer], { signal: new AbortController().signal, onProgress: () => {} });
    return result.op === "read" ? result.fields : [];
  } catch {
    return [];
  }
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
      summary: fill(en.signPdf.editedSummary, { name: file.name, pages: result.pageCount, size: formatSize(blob.size) }),
    };
  },
  async run({ files }, options, context) {
    const answers = readAnswers(options.answers ?? "");
    const flatten = options.flatten === "yes";
    // Answers the built-in font can't draw, such as Bangla, are drawn here in the page when they'll be flattened.
    const pictures: Record<string, LinePicture> = {};
    if (flatten) {
      for (const [name, answer] of Object.entries(answers)) {
        if (typeof answer !== "string" || !answer.trim() || canDraw(answer.replace(/\n/g, ""))) continue;
        const { textPicture } = await import("../../lib/pdf/text-picture");
        const picture = await textPicture(answer.replace(/\s*\n\s*/g, " "), { font: "helvetica", size: PICTURE_SIZE, bold: false, italic: false, color: "#000000" });
        pictures[name] = { ...picture, kind: "png" };
      }
    }
    const file = files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    let result: FormResult;
    try {
      result = await runner.run({ op: "fill", name: file.name, bytes, answers, flatten, pictures }, [bytes.buffer], context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "noFields") throw new ToolError(fill(t.noFieldsError, { name: file.name }));
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: file.name }));
    }
    if (result.op !== "fill") throw new Error("Unexpected result");
    const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
    return {
      files: [{ name: result.name, blob }],
      summary: fill(flatten ? t.summaryFlat : t.summary, { name: file.name, output: result.name, size: formatSize(blob.size) }),
    };
  },
};
