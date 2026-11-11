import { buildLines, cellsOf, type Line } from "../../lib/pdf/lines";
import type { TextPiece } from "../../lib/pdf/page-content";

// Turns a page's text into rows and columns: each line is a row, and text that lines up down the page shares a
// column, the way a table's figures do. Kept apart from pdf.js so it can be tested alone.

export interface Cell {
  text: string;
  bold: boolean;
}

export interface Grid {
  // Rows of cells by column; a missing cell is empty.
  rows: (Cell | undefined)[][];
  // Each column's width in points on the page, for sizing the sheet's columns.
  widths: number[];
}

// A gap between lines taller than this many letter sizes leaves an empty row, so separate blocks stay apart.
const BLOCK_GAP = 2.2;

interface Span {
  left: number;
  right: number;
}

// Columns from the cells of the lines that have the most of them: overlapping cells share a column.
function columnsOf(lines: Line[]): Span[] {
  const multi = lines.map(cellsOf).filter((cells) => cells.length > 1);
  if (!multi.length) return [];
  // Lines with fewer cells, like a heading that spans the table, would join columns that are really apart.
  const counts = multi.map((cells) => cells.length).sort((a, b) => a - b);
  const typical = counts[Math.floor(counts.length / 2)];
  const spans = multi
    .filter((cells) => cells.length >= typical)
    .flat()
    .map((cell) => ({ left: cell.x, right: cell.right }))
    .sort((a, b) => a.left - b.left);
  const columns: Span[] = [];
  for (const span of spans) {
    const last = columns[columns.length - 1];
    if (last && span.left <= last.right + 2) last.right = Math.max(last.right, span.right);
    else columns.push({ ...span });
  }
  return columns;
}

// The column a cell belongs in: the one it overlaps most, or else the nearest.
function columnFor(columns: Span[], cell: Span): number {
  let best = 0;
  let bestScore = -Infinity;
  for (const [index, column] of columns.entries()) {
    const overlap = Math.min(column.right, cell.right) - Math.max(column.left, cell.left);
    const score = overlap > 0 ? overlap : -Math.min(Math.abs(cell.left - column.right), Math.abs(column.left - cell.right));
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

export function buildGrid(pieces: TextPiece[]): Grid {
  const lines = buildLines(pieces);
  const columns = columnsOf(lines);
  const rows: (Cell | undefined)[][] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    if (previous && line.baseline - previous.baseline > Math.max(line.size, previous.size) * BLOCK_GAP) rows.push([]);
    const row: (Cell | undefined)[] = [];
    for (const cell of cellsOf(line)) {
      const at = columns.length ? columnFor(columns, { left: cell.x, right: cell.right }) : 0;
      const before = row[at];
      // Two pieces that land in one column share its cell.
      row[at] = before ? { text: `${before.text} ${cell.text}`, bold: before.bold && cell.bold } : { text: cell.text, bold: cell.bold };
    }
    rows.push(row);
    previous = line;
  }
  return { rows, widths: columns.length ? columns.map((column) => column.right - column.left) : [Math.max(0, ...lines.map((line) => line.right - line.x))] };
}

export type CellValue = { kind: "text"; text: string } | { kind: "number"; value: number; format: "general" | "whole" | "decimal" | "percent" };

// A cell as a number where it plainly is one, like "1,234.50", "(120)" or "15%", so the sheet can add it up.
// Codes with leading zeros and very long numbers, like phone numbers, stay as text.
export function cellValue(text: string): CellValue {
  const trimmed = text.trim().replace(/−/g, "-");
  const match = /^(\()?(-)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\))?(%)?$/.exec(trimmed);
  if (!match) return { kind: "text", text };
  const [, open, minus, whole, fraction = "", close, percent] = match;
  if (!!open !== !!close || (open && minus)) return { kind: "text", text };
  const digits = whole.replace(/,/g, "");
  if ((digits.length > 1 && digits.startsWith("0") && !whole.includes(",")) || digits.length + fraction.length > 16) return { kind: "text", text };
  let value = Number(`${digits}${fraction}`);
  if (open || minus) value = -value;
  if (percent) return { kind: "number", value: value / 100, format: "percent" };
  if (whole.includes(",")) return { kind: "number", value, format: fraction ? "decimal" : "whole" };
  return { kind: "number", value, format: "general" };
}
