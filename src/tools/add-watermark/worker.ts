import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import type { TextPicture } from "../../lib/pdf/stamp";
import { watermarkPdf, watermarkedName, type Settings, type WatermarkImage } from "./watermark";

export type WatermarkJob =
  | { op: "stamp"; files: { name: string; bytes: Uint8Array }[]; settings: Settings; image?: WatermarkImage; picture?: TextPicture }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type WatermarkResult =
  | { op: "stamp"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<WatermarkJob, WatermarkResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await watermarkPdf(file.bytes, job.settings, job.image, job.picture));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => watermarkedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "stamp", parts, names, zip }, transfer };
});
