import { serveJobs } from "../../lib/worker/host";
import { buildComparison, comparedName, type Word } from "./compare";

export type CompareJob = {
  op: "compare";
  before: { name: string; bytes: Uint8Array; removed: Word[] };
  after: { name: string; bytes: Uint8Array; added: Word[] };
  labels: { before: string; after: string };
};

export type CompareResult = { op: "compare"; bytes: Uint8Array; name: string };

serveJobs<CompareJob, CompareResult>(async (job, progress) => {
  const bytes = await buildComparison(job.before, job.after, job.labels);
  progress(1);
  return { result: { op: "compare", bytes, name: comparedName(job.after.name) }, transfer: [bytes.buffer as ArrayBuffer] };
});
