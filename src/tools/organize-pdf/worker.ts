import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { organizePdf, type PlanStep } from "./organize";

export type OrganizeJob =
  | { op: "organize"; files: { name: string; bytes: Uint8Array }[]; plan: PlanStep[] }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

serveJobs<OrganizeJob, { bytes: Uint8Array; pageCount: number }>(async (job, progress) => {
  const result = job.op === "organize" ? await organizePdf(job.files, job.plan, progress) : await rearrangePdf(job.bytes, job.plan);
  return { result, transfer: [result.bytes.buffer as ArrayBuffer] };
});
