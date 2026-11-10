import wasm from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { qpdfRunner } from "../../lib/pdf/qpdf";
import { JobError, serveJobs } from "../../lib/worker/host";
import { zipParts } from "../../lib/zip";
import { protectPdf, protectedName } from "./protect";

export type ProtectJob = { op: "protect"; files: { name: string; bytes: Uint8Array }[]; password: string };
export type ProtectResult = { op: "protect"; parts: Uint8Array[]; names: string[]; zip: Uint8Array | null };

const qpdf = qpdfRunner(wasm);

serveJobs<ProtectJob, ProtectResult>(async (job, progress) => {
  const parts: Uint8Array[] = [];
  for (const [index, file] of job.files.entries()) {
    try {
      parts.push(await protectPdf(qpdf, file.bytes, job.password));
    } catch (error) {
      // Say which file failed, so the page can name it.
      throw error instanceof JobError ? new JobError(error.code, String(index)) : error;
    }
    progress(((index + 1) / job.files.length) * 0.9);
  }
  const names = job.files.map((file) => protectedName(file.name));
  const zip = parts.length > 1 ? zipParts(parts.map((bytes, index) => ({ name: names[index], bytes }))) : null;
  progress(1);
  const transfer = [...parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "protect", parts, names, zip }, transfer };
});
