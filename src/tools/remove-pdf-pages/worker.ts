import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { removePages } from "./remove";

export type RemoveJob = { op: "remove"; bytes: Uint8Array; pages: string } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type RemoveResult =
  | { op: "remove"; bytes: Uint8Array; pageCount: number; removed: number }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<RemoveJob, RemoveResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const result = await removePages(job.bytes, job.pages);
  progress(1);
  return { result: { op: "remove", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
});
