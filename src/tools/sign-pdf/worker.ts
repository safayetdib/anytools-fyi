import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import type { Mark } from "./marks";
import { signPdf, signedName, type Placement, type SignatureImage } from "./sign";

export type SignJob =
  | { op: "sign"; name: string; bytes: Uint8Array; images: Partial<Record<Mark, SignatureImage>>; placements: Placement[] }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type SignResult = { op: "sign"; bytes: Uint8Array; name: string } | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<SignJob, SignResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const bytes = await signPdf(job.bytes, job.images, job.placements);
  progress(1);
  return { result: { op: "sign", bytes, name: signedName(job.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
