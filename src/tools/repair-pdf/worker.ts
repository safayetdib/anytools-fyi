import wasm from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { rearrangePdf } from "../../lib/pdf/rearrange";
import { qpdfRunner } from "../../lib/pdf/qpdf";
import type { PagePlan } from "../../lib/shell/types";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { repairPdf, repairedName } from "./repair";

export type RepairJob = { op: "repair"; files: { name: string; bytes: Uint8Array }[] } | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type RepairResult =
  | { op: "repair"; parts: Uint8Array[]; fixed: boolean[]; names: string[]; zip: Uint8Array | null }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

const qpdf = qpdfRunner(wasm);

serveJobs<RepairJob, RepairResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  const parts: Uint8Array[] = [];
  const fixed: boolean[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      const repaired = await repairPdf(qpdf, file.bytes);
      parts.push(repaired.bytes);
      fixed.push(repaired.fixed);
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => repairedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "repair", parts, fixed, names, zip }, transfer };
});
