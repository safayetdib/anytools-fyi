// Page numbers here are 1-based, the way people see them.
export interface Part {
  from: number;
  to: number;
}

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

const PIECE = /^(\d+)(?:[-–](\d*))?$/;

// Only digits, commas and dashes can be typed in a page list, like most PDF tools allow.
export function cleanPageList(text: string): string {
  return text.replace(/[^\d,\-–]/g, "");
}

// Reads "1,5-8" and "8-" (to the end), in page order with repeats counted once.
// Pieces that don't make sense, such as a page past the end, are skipped rather than refused.
export function parsePageList(text: string, pageCount: number): number[] {
  const pages = new Set<number>();
  for (const piece of cleanPageList(text).split(",")) {
    const match = piece.match(PIECE);
    if (!match) continue;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : match[2] === "" ? pageCount : Number(match[2]);
    if (checkRange({ from, to }, pageCount)) continue;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

// Fixes a typed range the way people expect: within the file, and never ending before it starts.
export function clampRange({ from, to }: Part, pageCount: number): Part {
  const first = Math.min(Math.max(Number.isInteger(from) ? from : 1, 1), pageCount);
  const last = Math.min(Math.max(Number.isInteger(to) ? to : first, 1), pageCount);
  return { from: first, to: Math.max(first, last) };
}

export function checkRange({ from, to }: Part, pageCount: number): "invalid" | "outOfRange" | "reversed" | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return "invalid";
  if (from < 1 || to > pageCount || from > pageCount) return "outOfRange";
  if (to < from) return "reversed";
  return null;
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

// Runs of neighbouring pages, keeping the given order: [1, 2, 3, 7] becomes 1–3 and 7.
export function compressPages(pages: number[]): Part[] {
  const runs: Part[] = [];
  for (const page of pages) {
    const last = runs.at(-1);
    if (last && page === last.to + 1) last.to = page;
    else runs.push({ from: page, to: page });
  }
  return runs;
}

export function fileName(original: string, pages: number[], index: number, style: NameStyle): string {
  const base = original.replace(/\.pdf$/i, "") || "document";
  if (style === "numbered") return `${base}-${index + 1}.pdf`;
  if (style === "extracted") return `${base}-extracted.pdf`;
  // Like most PDF tools: "report-1-4.pdf" for a range, "report-7.pdf" for a single page.
  if (style === "page") return `${base}-${pages[0]}.pdf`;
  return `${base}-${pages[0]}-${pages.at(-1)}.pdf`;
}
