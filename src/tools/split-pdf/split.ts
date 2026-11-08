import { PDFDocument } from "pdf-lib";
import { JobError } from "../../lib/worker/host";
import { MAX_PARTS, fileName, planOutputs, type SplitRequest } from "./plan";

export class SplitError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "range", detail?: string) {
    super(code, detail);
  }
}

export interface SplitOutput {
  parts: Uint8Array[];
  // The pages in each part, in order.
  outputs: number[][];
  names: string[];
  pageCount: number;
  // Pages bigger than the size limit on their own, which became files by themselves.
  oversize: number;
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

async function savePages(source: PDFDocument, pages: number[]): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  (await document.copyPages(source, pages.map((page) => page - 1))).forEach((page) => document.addPage(page));
  return document.save();
}

// Splits into files no larger than maxBytes, keeping pages in order and never splitting a page.
// Each page's own size is a first guess; real sizes then decide, joining neighbours while they still fit.
async function splitBySize(source: PDFDocument, maxBytes: number, onProgress: (fraction: number) => void) {
  const pageCount = source.getPageCount();
  const guesses: number[][] = [];
  let group: number[] = [];
  let total = 0;
  for (let page = 1; page <= pageCount; page++) {
    const size = (await savePages(source, [page])).length;
    if (group.length && total + size > maxBytes) {
      guesses.push(group);
      group = [];
      total = 0;
    }
    group.push(page);
    total += size;
    onProgress((page / pageCount) * 0.4);
  }
  guesses.push(group);

  const done: { pages: number[]; bytes: Uint8Array }[] = [];
  let oversize = 0;
  // A file over the limit is halved until it fits, or until it's a single page that can't be smaller.
  async function settle(pages: number[], bytes: Uint8Array) {
    if (bytes.length <= maxBytes || pages.length === 1) {
      if (bytes.length > maxBytes) oversize++;
      done.push({ pages, bytes });
      return;
    }
    const half = Math.ceil(pages.length / 2);
    for (const piece of [pages.slice(0, half), pages.slice(half)]) await settle(piece, await savePages(source, piece));
  }

  let current = guesses[0];
  let currentBytes = await savePages(source, current);
  for (const next of guesses.slice(1)) {
    const joined = [...current, ...next];
    const joinedBytes = await savePages(source, joined);
    if (joinedBytes.length <= maxBytes) {
      current = joined;
      currentBytes = joinedBytes;
    } else {
      await settle(current, currentBytes);
      current = next;
      currentBytes = await savePages(source, next);
    }
    onProgress(0.4 + ((current.at(-1) as number) / pageCount) * 0.6);
  }
  await settle(current, currentBytes);
  onProgress(1);
  return { done, oversize };
}

export async function splitPdf(
  bytes: Uint8Array,
  request: SplitRequest,
  originalName: string,
  onProgress: (fraction: number) => void,
): Promise<SplitOutput> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new SplitError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const pageCount = source.getPageCount();

  if (request.mode === "size") {
    const { done, oversize } = await splitBySize(source, request.maxBytes, onProgress);
    if (done.length > MAX_PARTS) throw new SplitError("range", `tooMany||${pageCount}`);
    const outputs = done.map((part) => part.pages);
    return {
      parts: done.map((part) => part.bytes),
      outputs,
      names: outputs.map((pages, index) => fileName(originalName, pages, index, "numbered")),
      pageCount,
      oversize,
    };
  }

  const plan = planOutputs(request, pageCount);
  if (!plan.ok) throw new SplitError("range", `${plan.reason}|${plan.range ?? ""}|${pageCount}`);
  const parts: Uint8Array[] = [];
  for (const [index, pages] of plan.outputs.entries()) {
    parts.push(await savePages(source, pages));
    onProgress((index + 1) / plan.outputs.length);
  }
  return {
    parts,
    outputs: plan.outputs,
    names: plan.outputs.map((pages, index) => fileName(originalName, pages, index, plan.style)),
    pageCount,
    oversize: 0,
  };
}
