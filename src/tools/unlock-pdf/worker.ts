import wasm from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { rearrangePdf } from "../../lib/pdf/rearrange";
import { qpdfRunner } from "../../lib/pdf/qpdf";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { unlockPdf, unlockedName } from "./unlock";

export type UnlockJob =
  | { op: "unlock"; files: { name: string; bytes: Uint8Array; password: string }[] }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type UnlockResult =
  | { op: "unlock"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

const qpdf = qpdfRunner(wasm);

serveJobs<UnlockJob, UnlockResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await unlockPdf(qpdf, file.bytes, file.password));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => unlockedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "unlock", parts, names, zip }, transfer };
});
