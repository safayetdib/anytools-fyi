import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { addTextLayers, ocrName } from "./ocr";

export type OcrJob =
  | { op: "ocr"; files: { name: string; bytes: Uint8Array; layers: { page: number; layer: Uint8Array }[] }[] }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type OcrResult =
  | { op: "ocr"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<OcrJob, OcrResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await addTextLayers(file.bytes, file.layers));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => ocrName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "ocr", parts, names, zip }, transfer };
});
