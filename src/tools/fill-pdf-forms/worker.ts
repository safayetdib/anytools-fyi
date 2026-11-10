import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import type { LinePicture } from "../edit-pdf/edit";
import { fillForm, filledName, readForm, type Answers, type FormField } from "./forms";

export type FormJob =
  | { op: "read"; bytes: Uint8Array }
  | { op: "fill"; name: string; bytes: Uint8Array; answers: Answers; flatten: boolean; pictures: Record<string, LinePicture> }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type FormResult =
  | { op: "read"; fields: FormField[] }
  | { op: "fill"; bytes: Uint8Array; name: string }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<FormJob, FormResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  if (job.op === "read") return { result: { op: "read", fields: await readForm(job.bytes) }, transfer: [] };
  const bytes = await fillForm(job.bytes, job.answers, job.flatten, job.pictures);
  progress(1);
  return { result: { op: "fill", bytes, name: filledName(job.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
