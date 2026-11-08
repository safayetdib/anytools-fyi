import { rearrangePdf } from "../../lib/pdf/rearrange";
import type { PagePlan } from "../../lib/shell/types";
import { serveJobs } from "../../lib/worker/host";
import type { SplitRequest } from "./plan";
import { zipParts } from "../../lib/zip";
import { splitPdf } from "./split";

export type SplitJob =
  | { op: "split"; bytes: Uint8Array; name: string; request: SplitRequest }
  | { op: "rearrange"; bytes: Uint8Array; plan: PagePlan };

export type SplitResult =
  | {
      op: "split";
      parts: Uint8Array[];
      outputs: number[][];
      names: string[];
      zip: Uint8Array | null;
      pageCount: number;
      oversize: number;
    }
  | { op: "rearrange"; bytes: Uint8Array; pageCount: number };

serveJobs<SplitJob, SplitResult>(async (job, progress) => {
  if (job.op === "rearrange") {
    const result = await rearrangePdf(job.bytes, job.plan);
    return { result: { op: "rearrange", ...result }, transfer: [result.bytes.buffer as ArrayBuffer] };
  }
  // The ZIP is the last step, so splitting fills the bar up to 90%.
  const split = await splitPdf(job.bytes, job.request, job.name, (value) => progress(value * 0.9));
  const zip = split.parts.length > 1 ? zipParts(split.parts.map((bytes, index) => ({ name: split.names[index], bytes }))) : null;
  progress(1);
  const transfer = [...split.parts, ...(zip ? [zip] : [])].map((bytes) => bytes.buffer as ArrayBuffer);
  return { result: { op: "split", ...split, zip }, transfer };
});
