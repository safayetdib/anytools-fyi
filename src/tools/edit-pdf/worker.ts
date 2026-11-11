import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { editPdf, editedName, type Edit, type EditImage, type LinePicture } from "./edit";

export type EditJob =
  | { op: "edit"; name: string; bytes: Uint8Array; edits: Edit[]; images: EditImage[]; pictures: Record<number, LinePicture[]> }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type EditResult = { op: "edit"; bytes: Uint8Array; name: string } | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<EditJob, EditResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const bytes = await editPdf(job.bytes, job.edits, job.images, job.pictures);
  progress(1);
  return { result: { op: "edit", bytes, name: editedName(job.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
