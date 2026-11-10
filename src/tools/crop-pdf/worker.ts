import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { cropPdf, croppedName, type CropPlan } from "./crop";

export type CropJob = { op: "crop"; name: string; bytes: Uint8Array; plan: CropPlan } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type CropResult = { op: "crop"; bytes: Uint8Array; name: string } | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<CropJob, CropResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const bytes = await cropPdf(job.bytes, job.plan);
  progress(1);
  return { result: { op: "crop", bytes, name: croppedName(job.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
