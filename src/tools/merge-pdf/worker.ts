import { serveJobs } from "../../lib/worker/host";
import { mergePdfs, type MergeInput } from "./merge";

serveJobs<{ files: MergeInput[] }, { bytes: Uint8Array; pageCount: number }>(async ({ files }, progress) => {
  const result = await mergePdfs(files, progress);
  return { result, transfer: [result.bytes.buffer as ArrayBuffer] };
});
