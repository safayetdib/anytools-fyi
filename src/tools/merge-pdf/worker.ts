import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { mergePdfs, type MergeInput } from "./merge";

export type MergeJob = { op: "merge"; files: MergeInput[] } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

serveJobs<MergeJob, { bytes: Uint8Array; pageCount: number }>(async (job, progress) => {
  const result = job.op === "merge" ? await mergePdfs(job.files, progress) : await rearrangePdf(job.bytes, job.plan);
  return { result, transfer: [result.bytes.buffer as ArrayBuffer] };
});
