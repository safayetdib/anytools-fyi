import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { buildPdf, type PreparedImage, type Settings } from "./layout";

export type ImagesJob =
  | { op: "build"; images: PreparedImage[]; names: string[]; settings: Settings }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type ImagesResult =
  | { op: "build"; parts: Uint8Array[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<ImagesJob, ImagesResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  // Merged: one PDF of every image. Otherwise one PDF per image, packed in a ZIP when there are several.
  const groups = job.settings.merge ? [job.images] : job.images.map((image) => [image]);
  const parts: Uint8Array[] = [];
  for (const [index, group] of groups.entries()) {
    parts.push(await buildPdf(group, job.settings));
    progress(((index + 1) / groups.length) * 0.9);
  }
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: job.names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "build", parts, zip }, transfer };
});
