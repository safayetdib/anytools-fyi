import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { resizePdf, resizedName, type ResizeSettings } from "./resize";

export type ResizeJob = { op: "resize"; files: { name: string; bytes: Uint8Array }[]; settings: ResizeSettings } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type ResizeResult =
  | { op: "resize"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<ResizeJob, ResizeResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await resizePdf(file.bytes, job.settings));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.95);
  }
  const names = job.files.map((file) => resizedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "resize", parts, names, zip }, transfer };
});
