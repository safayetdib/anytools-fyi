import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { cleanName, removeMetadata, type Detail } from "./metadata";

export type MetadataJob = { op: "clean"; files: { name: string; bytes: Uint8Array }[] } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type MetadataResult =
  | { op: "clean"; parts: Uint8Array[]; names: string[]; removed: Detail[][]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<MetadataJob, MetadataResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  const removed: Detail[][] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      const result = await removeMetadata(file.bytes);
      parts.push(result.bytes);
      removed.push(result.removed);
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.95);
  }
  const names = job.files.map((file) => cleanName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "clean", parts, names, removed, zip }, transfer };
});
