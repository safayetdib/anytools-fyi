// Page numbers are 1-based, the way people see them.
export interface Part {
  from: number;
  to: number;
}

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

export function checkRange({ from, to }: Part, pageCount: number): "invalid" | "outOfRange" | "reversed" | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return "invalid";
  if (from < 1 || to > pageCount || from > pageCount) return "outOfRange";
  if (to < from) return "reversed";
  return null;
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
