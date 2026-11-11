import type { FontStyle, TextPiece } from "./page-content";

// Puts a page's pieces of text back into lines, the way they read. Kept apart from pdf.js so it can be tested alone.

// What comes between a piece and the one before it on its line.
export type Gap = "none" | "space" | "column";

export interface LinePiece extends TextPiece {
  gap: Gap;
}

export interface Line {
  pieces: LinePiece[];
  x: number;
  right: number;
  baseline: number;
  // The largest letters on the line.
  size: number;
  text: string;
  // True when the line has text set apart in columns, like a table row.
  columns: boolean;
}

// A bullet, or a number or letter and a stop, with nothing after it.
const LIST_MARK_ONLY = /^([•●▪◦‣∙·○■□➢➤►✓✔*–\u2014-]|\(?(\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4}|[০-৯]{1,3})[.)])$/;
// A gap wider than this many letter sizes splits a line into columns.
const COLUMN_GAP = 1.5;
// A gap narrower than this many letter sizes is the space inside a word, as when a PDF draws letters one by one.
const WORD_GAP = 0.12;

export function lineText(pieces: LinePiece[]): string {
  return pieces.map((piece) => (piece.gap === "none" ? "" : piece.gap === "space" ? " " : "\t") + piece.text).join("");
}

function finish(pieces: LinePiece[]): Line {
  // Spaces at either end take no room in the line.
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  const size = Math.max(...pieces.map((piece) => piece.size));
  return {
    pieces,
    x: first.x,
    right: last.x + last.width,
    baseline: first.baseline,
    size,
    text: lineText(pieces),
    columns: pieces.some((piece) => piece.gap === "column"),
  };
}

// Lines in the order the PDF draws them, which is nearly always reading order, even across columns.
export function buildLines(pieces: TextPiece[]): Line[] {
  const lines: Line[] = [];
  let current: LinePiece[] = [];
  let right = 0;
  for (const piece of pieces) {
    const text = piece.text.replace(/\s+/g, " ");
    if (!text.trim()) {
      // A space on its own only marks a gap.
      if (current.length && piece.upright) current[current.length - 1] = { ...current[current.length - 1], text: `${current[current.length - 1].text}${text}` };
      continue;
    }
    const previous = current[current.length - 1];
    const size = Math.max(piece.size, previous?.size ?? 0);
    const sameLine =
      previous &&
      piece.upright &&
      previous.upright &&
      Math.abs(piece.baseline - previous.baseline) < size * 0.5 &&
      piece.x > right - size * 0.5;
    if (!sameLine) {
      if (current.length) lines.push(finish(current));
      current = [];
    }
    let gap: Gap = "none";
    if (current.length) {
      const space = piece.x - right;
      const spaced = /\s$/.test(current[current.length - 1].text) || /^\s/.test(text);
      if (space > size * COLUMN_GAP) gap = "column";
      else if (spaced || space > size * WORD_GAP) gap = "space";
    }
    current.push({ ...piece, text: gap === "none" && current.length ? text : text.trimStart(), gap });
    if (gap !== "none") {
      const before = current[current.length - 2];
      current[current.length - 2] = { ...before, text: before.text.trimEnd() };
    }
    right = piece.x + piece.width;
  }
  if (current.length) lines.push(finish(current));
  // Some design apps draw a list's numbers and bullets after the text beside them. Each goes back to the start of its line.
  for (let index = lines.length - 1; index >= 0; index--) {
    const mark = lines[index];
    if (!LIST_MARK_ONLY.test(mark.text)) continue;
    for (let back = index - 1; back >= Math.max(0, index - 12); back--) {
      const line = lines[back];
      if (Math.abs(line.baseline - mark.baseline) < mark.size * 0.5 && line.x >= mark.right - mark.size * 0.2 && line.x - mark.right < mark.size * 3) {
        lines[back] = finish([...mark.pieces, { ...line.pieces[0], gap: "space" }, ...line.pieces.slice(1)]);
        lines.splice(index, 1);
        break;
      }
    }
  }
  return lines.map((line) => finish(line.pieces.map((piece, index) => (index === line.pieces.length - 1 ? { ...piece, text: piece.text.trimEnd() } : piece)).filter((piece) => piece.text || piece.gap !== "none")));
}

export const sameFont = (a: FontStyle, b: FontStyle) => a.family === b.family && a.bold === b.bold && a.italic === b.italic;

// The font most of a line is set in, by letters.
export function mainFont(line: Line): FontStyle {
  const counts = new Map<string, { font: FontStyle; count: number }>();
  for (const piece of line.pieces) {
    const key = `${piece.font.family}|${piece.font.bold}|${piece.font.italic}`;
    const entry = counts.get(key) ?? { font: piece.font, count: 0 };
    entry.count += piece.text.length;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0].font;
}

// The pieces of a line split where it has columns: each cell's text and where it starts and ends.
export function cellsOf(line: Line): { text: string; x: number; right: number; bold: boolean }[] {
  const cells: LinePiece[][] = [];
  for (const piece of line.pieces) {
    if (!cells.length || piece.gap === "column") cells.push([]);
    cells[cells.length - 1].push(piece);
  }
  return cells.map((pieces) => ({
    text: lineText([{ ...pieces[0], gap: "none" }, ...pieces.slice(1)]),
    x: pieces[0].x,
    right: pieces[pieces.length - 1].x + pieces[pieces.length - 1].width,
    bold: pieces.every((piece) => piece.font.bold),
  }));
}
