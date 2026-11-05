import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { WorkerJobFailed, createWorkerRunner } from "../../lib/worker/client";
import type { MergeInput } from "./merge";

const t = en.mergePdf;
const MB = 1024 * 1024;

const runner = createWorkerRunner<{ files: MergeInput[] }, { bytes: Uint8Array; pageCount: number }>(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "merge-pdf" }),
);

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    multiple: true,
    minFiles: 2,
    maxFileSize: 100 * MB,
    warnFileSize: 30 * MB,
  },
  warm: () => void runner.warm(),
  async run({ files }, _options, context) {
    const inputs = await Promise.all(
      files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
    );
    try {
      const { bytes, pageCount } = await runner.run(
        { files: inputs },
        inputs.map((input) => input.bytes.buffer),
        context,
      );
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      return {
        files: [{ name: t.outputName, blob }],
        summary: fill(t.summary, { count: files.length, pages: pageCount, size: formatSize(blob.size) }),
      };
    } catch (error) {
      if (error instanceof WorkerJobFailed) {
        throw new ToolError(fill(error.code === "encrypted" ? t.encrypted : t.unreadable, { name: error.detail ?? "" }));
      }
      throw error;
    }
  },
};
