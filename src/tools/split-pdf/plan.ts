import { checkRange, cleanPageList, compressPages, parsePageList, type Part } from "../../lib/pdf/page-list";

export { checkRange, cleanPageList, compressPages, parsePageList, type Part };

// The choices from the options panel. Size splitting needs the file itself, so it's planned in split.ts.
export type SplitRequest =
  | { mode: "ranges"; ranges: Part[]; merge: boolean }
  | { mode: "fixed"; size: number }
  | { mode: "all" }
  | { mode: "select"; pages: string; merge: boolean }
  | { mode: "size"; maxBytes: number };

export type NameStyle = "range" | "numbered" | "page" | "extracted";

// Keeps a ZIP of single pages practical on phones.
export const MAX_PARTS = 300;

export type RangeProblem = "empty" | "invalid" | "outOfRange" | "reversed" | "tooMany";

export type PlanResult =
  | { ok: true; outputs: number[][]; style: NameStyle }
  | { ok: false; reason: RangeProblem; range?: string };

// Fixes a typed range the way people expect: within the file, and never ending before it starts.
export function clampRange({ from, to }: Part, pageCount: number): Part {
  const first = Math.min(Math.max(Number.isInteger(from) ? from : 1, 1), pageCount);
  const last = Math.min(Math.max(Number.isInteger(to) ? to : first, 1), pageCount);
  return { from: first, to: Math.max(first, last) };
}

const span = ({ from, to }: Part) => Array.from({ length: to - from + 1 }, (_, offset) => from + offset);

export function fixedParts(size: number, pageCount: number): Part[] {
  const step = Math.max(1, Math.floor(size) || 1);
  const parts: Part[] = [];
  for (let from = 1; from <= pageCount; from += step) parts.push({ from, to: Math.min(from + step - 1, pageCount) });
  return parts;
}

// Which pages go into each new file, for every mode except size.
export function planOutputs(request: Exclude<SplitRequest, { mode: "size" }>, pageCount: number): PlanResult {
  let outputs: number[][];
  let style: NameStyle;
  if (request.mode === "ranges") {
    for (const [index, range] of request.ranges.entries()) {
      const problem = checkRange(range, pageCount);
      if (problem) return { ok: false, reason: problem, range: String(index + 1) };
    }
    if (!request.ranges.length) return { ok: false, reason: "empty" };
    outputs = request.merge ? [request.ranges.flatMap(span)] : request.ranges.map(span);
    style = request.merge ? "extracted" : "range";
  } else if (request.mode === "fixed") {
    outputs = fixedParts(request.size, pageCount).map(span);
    style = "numbered";
  } else if (request.mode === "all") {
    outputs = Array.from({ length: pageCount }, (_, index) => [index + 1]);
    style = "page";
  } else {
    const pages = parsePageList(request.pages, pageCount);
    if (!pages.length) return { ok: false, reason: "empty" };
    outputs = request.merge ? [pages] : pages.map((page) => [page]);
    style = request.merge ? "extracted" : "page";
  }
  if (outputs.length > MAX_PARTS) return { ok: false, reason: "tooMany" };
  return { ok: true, outputs, style };
}

export function fileName(original: string, pages: number[], index: number, style: NameStyle): string {
  const base = original.replace(/\.pdf$/i, "") || "document";
  if (style === "numbered") return `${base}-${index + 1}.pdf`;
  if (style === "extracted") return `${base}-extracted.pdf`;
  // Like most PDF tools: "report-1-4.pdf" for a range, "report-7.pdf" for a single page.
  if (style === "page") return `${base}-${pages[0]}.pdf`;
  return `${base}-${pages[0]}-${pages.at(-1)}.pdf`;
}
