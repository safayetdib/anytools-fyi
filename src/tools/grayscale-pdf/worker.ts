import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { grayJpeg } from "./encode";
import { grayName, grayscalePdf } from "./gray";

export type GrayJob = { op: "gray"; files: { name: string; bytes: Uint8Array }[] } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type GrayResult =
  | { op: "gray"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<GrayJob, GrayResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  const share = 0.95 / job.files.length;
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await grayscalePdf(file.bytes, grayJpeg, (fraction) => progress(index * share + fraction * share)));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
  }
  const names = job.files.map((file) => grayName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "gray", parts, names, zip }, transfer };
});
