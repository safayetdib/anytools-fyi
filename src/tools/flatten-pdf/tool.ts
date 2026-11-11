import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { FlattenJob, FlattenResult } from "./worker";

const t = en.flattenPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<FlattenJob, FlattenResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "flatten-pdf" }));

// "2 form fields and 1 comment".
function whatWasFlattened(fields: number, marks: number): string {
  const parts = [fields ? fill(fields === 1 ? t.fieldOne : t.fieldMany, { count: fields }) : "", marks ? fill(marks === 1 ? t.markOne : t.markMany, { count: marks }) : ""];
  return parts.filter(Boolean).join(t.and);
}

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is flattened on its own, so their order doesn't matter.
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
    const choice = { forms: options.forms === "yes", marks: options.marks === "yes" };
    if (!choice.forms && !choice.marks) throw new ToolError(t.chooseOne);
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    let result: FlattenResult;
    try {
      result = await runner.run({ op: "flatten", files: inputs, choice }, inputs.map((input) => input.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "nothing") throw new ToolError(files.length > 1 ? t.nothingMany : fill(t.nothing, { name: inputs[0]?.name ?? "" }));
      const name = inputs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name }));
    }
    if (result.op !== "flatten") throw new Error("Unexpected result");
    const what = whatWasFlattened(result.fields, result.marks);
    const pdfs = result.parts.map((part) => new Blob([part as BlobPart], { type: "application/pdf" }));
    if (pdfs.length === 1 && files.length === 1) {
      return {
        files: [{ name: result.names[0], blob: pdfs[0] }],
        summary: fill(t.summaryOne, { name: files[0].name, what, output: result.names[0], size: formatSize(pdfs[0].size) }),
      };
    }
    const skipped = files.length - pdfs.length;
    const zip = result.zip ? new Blob([result.zip as BlobPart], { type: "application/zip" }) : pdfs[0];
    return {
      files: [{ name: result.zip ? t.zipName : result.names[0], blob: zip }],
      parts: pdfs.map((blob, index) => ({ name: result.names[index], blob, label: fill(t.part, { name: files[result.sources[index]].name }) })),
      summary: fill(skipped ? t.summarySkipped : t.summaryMany, { count: pdfs.length, what, skipped, size: formatSize(zip.size) }),
    };
  },
};
