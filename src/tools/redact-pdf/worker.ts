import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { redactPdf, redactedName, type RedactedPage } from "./redact";

export type RedactJob = { op: "redact"; name: string; bytes: Uint8Array; pages: RedactedPage[] } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type RedactResult = { op: "redact"; bytes: Uint8Array; name: string } | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<RedactJob, RedactResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const bytes = await redactPdf(job.bytes, job.pages);
  progress(1);
  return { result: { op: "redact", bytes, name: redactedName(job.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
