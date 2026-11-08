import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { compressPdf, compressedName, type Level } from "./compress";
import { encodeJpeg } from "./encode";

export type CompressJob =
  | { op: "compress"; files: { name: string; bytes: Uint8Array }[]; level: Level }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type CompressResult =
  | { op: "compress"; parts: Uint8Array[]; names: string[]; before: number[]; smaller: boolean[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<CompressJob, CompressResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  const smaller: boolean[] = [];
  const before = job.files.map((file) => file.bytes.length);
  for (const [index, file] of job.files.entries()) {
    try {
      const share = 0.95 / job.files.length;
      const result = await compressPdf(file.bytes, job.level, encodeJpeg, (fraction) => progress(index * share + fraction * share));
      parts.push(result.bytes);
      smaller.push(result.smaller);
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
  }
  const names = job.files.map((file) => compressedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  // A file that couldn't be made smaller comes back as the original bytes, so copies are sent rather than moved twice.
  const transfer = [...new Set([...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer))];
  return { result: { op: "compress", parts, names, before, smaller, zip }, transfer };
});
