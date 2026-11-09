import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import { passwordProblem } from "./password";
import type { ProtectJob, ProtectResult } from "./worker";

const t = en.protectPdf;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

const runner = createWorkerRunner<ProtectJob, ProtectResult>(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "protect-pdf" }));

// The results need the password to open, so there's no page preview after protecting.
export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    // Each PDF is protected on its own, so their order doesn't matter.
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
  async run({ files }, options, context) {
    const password = options.password ?? "";
    if (passwordProblem(password, password)) throw new ToolError(t.needPassword);
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
    let result: ProtectResult;
    try {
      result = await runner.run({ op: "protect", files: inputs, password }, inputs.map((input) => input.bytes.buffer), context);
    } catch (error) {
      if (!(error instanceof WorkerJobFailed)) throw error;
      if (error.code === "password") throw new ToolError(t.needPassword);
      const name = inputs[Number(error.detail)]?.name ?? "";
      throw new ToolError(fill(error.code === "locked" ? t.alreadyLocked : t.unreadable, { name }));
    }
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
