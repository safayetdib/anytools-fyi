import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { flattenPdf, flattenedName, type FlattenChoice } from "./flatten";

export type FlattenJob = { op: "flatten"; files: { name: string; bytes: Uint8Array }[]; choice: FlattenChoice } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type FlattenResult =
  | { op: "flatten"; parts: Uint8Array[]; names: string[]; sources: number[]; fields: number; marks: number; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<FlattenJob, FlattenResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  const sources: number[] = [];
  let fields = 0;
  let marks = 0;
  for (const [index, file] of job.files.entries()) {
    try {
      const result = await flattenPdf(file.bytes, job.choice);
      parts.push(result.bytes);
      sources.push(index);
      fields += result.fields;
      marks += result.marks;
    } catch (error) {
      // A PDF with nothing to flatten is left out when there are others; on its own, the page says so.
      if (error instanceof JobError && error.code === "nothing" && job.files.length > 1) continue;
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.95);
  }
  if (!parts.length) throw new JobError("nothing", "all");
  const names = sources.map((index) => flattenedName(job.files[index].name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "flatten", parts, names, sources, fields, marks, zip }, transfer };
});
