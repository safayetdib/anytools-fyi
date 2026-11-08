import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { numberPdf, numberedName, type Settings } from "./numbers";

export type NumbersJob =
  | { op: "number"; files: { name: string; bytes: Uint8Array }[]; settings: Settings }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type NumbersResult =
  | { op: "number"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<NumbersJob, NumbersResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await numberPdf(file.bytes, job.settings));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => numberedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "number", parts, names, zip }, transfer };
});
