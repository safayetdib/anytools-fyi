import { buildLines, type Line, type LinePiece } from "../../lib/pdf/lines";
import type { FontStyle, PageContent } from "../../lib/pdf/page-content";

// Turns a page's lines into text boxes sitting where the text was, so a slide can show the page as a picture with
// its text on top, ready to edit. Kept apart from pdf.js so it can be tested alone.

export interface SlideRun {
  text: string;
  font: FontStyle;
  size: number;
  // "RRGGBB".
  colour: string;
}

export interface SlideParagraph {
  runs: SlideRun[];
}

export interface TextBox {
  // In points on the page as shown, from its top-left corner. A turned box turns about its middle.
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  align: "l" | "ctr" | "r";
  // Line spacing, as a share of single spacing.
  spacing: number;
  paragraphs: SlideParagraph[];
  // A colour filling the box, "RRGGBB", to cover a scan's own picture of the text.
  fill?: string;
}

// Lines further apart than this many letter sizes go in separate boxes.
const LINE_GAP = 1.75;
// PowerPoint's single line spacing, as a multiple of the letter size, and where the letters sit in it.
const SINGLE_LINE = 1.2;
const ASCENT = 0.95;
// Room for fonts that set a little wider than the PDF's own.
const SPARE_WIDTH = 1.06;

const spread = (values: number[]) => Math.max(...values) - Math.min(...values);

// A line with columns, like a table row, splits into a line for each cell, so each keeps its place.
function splitCells(line: Line): Line[] {
  if (!line.columns) return [line];
  const cells: LinePiece[][] = [];
  for (const piece of line.pieces) {
    if (!cells.length || piece.gap === "column") cells.push([]);
    cells[cells.length - 1].push(piece.gap === "column" ? { ...piece, gap: "none" } : piece);
  }
  return cells.map((pieces) => ({
    ...line,
    pieces,
    x: pieces[0].x,
    right: pieces[pieces.length - 1].x + pieces[pieces.length - 1].width,
    text: pieces.map((piece) => piece.text).join(" "),
    columns: false,
  }));
}

function belongs(group: Line[], line: Line): boolean {
  const previous = group[group.length - 1];
  const size = Math.max(previous.size, line.size);
  const step = line.baseline - previous.baseline;
  if (!line.pieces[0].upright || !previous.pieces[0].upright) return false;
  if (step <= 0 || step > size * LINE_GAP) return false;
  if (Math.abs(line.size - previous.size) > previous.size * 0.2) return false;
  const left = Math.min(...group.map((l) => l.x));
  const right = Math.max(...group.map((l) => l.right));
  return line.x < right && line.right > left;
}

function alignOf(group: Line[]): TextBox["align"] {
  if (group.length < 2) return "l";
  const size = group[0].size;
  if (spread(group.map((line) => line.x)) < size * 0.5) return "l";
  if (spread(group.map((line) => (line.x + line.right) / 2)) < size * 0.5) return "ctr";
  if (spread(group.map((line) => line.right)) < size * 0.5) return "r";
  return "l";
}

type Box = { x: number; y: number; width: number; height: number };

// `colourOf` finds the colour of the text in a box on the page. For text hidden behind a scan, `scanOf` finds the
// paper's and ink's colours instead, and each box is filled with the paper to cover the scan's picture of its text.
export function textBoxes(content: PageContent, colourOf: (box: Box) => string, scanOf?: (box: Box) => { paper: string; ink: string }): TextBox[] {
  const lines = buildLines(content.pieces).flatMap(splitCells);
  const groups: Line[][] = [];
  for (const line of lines) {
    const group = groups[groups.length - 1];
    if (group && belongs(group, line)) group.push(line);
    else groups.push([line]);
  }
  return groups.map((group) => {
    const size = Math.max(...group.map((line) => line.size));
    const steps = group.slice(1).map((line, index) => line.baseline - group[index].baseline);
    const spacing = steps.length ? Math.min(3, Math.max(0.7, steps.reduce((a, b) => a + b, 0) / steps.length / (size * SINGLE_LINE))) : 1;
    const paragraphs = group.map((line) => ({
      runs: line.pieces.map((piece) => ({
        text: (piece.gap === "none" ? "" : piece.gap === "space" ? " " : "\t") + piece.text,
        font: piece.font,
        size: Math.round(piece.size * 2) / 2,
        colour: colourOf({ x: piece.x, y: piece.baseline - piece.size * 0.8, width: piece.width, height: piece.size }),
      })),
    }));
    const first = group[0];
    const firstPiece = first.pieces[0];
    if (!firstPiece.upright) {
      // Turned text: a box along the line, turned about its middle to match.
      const width = (first.right - first.x) * SPARE_WIDTH;
      const height = size * SINGLE_LINE;
      const turn = (firstPiece.angle * Math.PI) / 180;
      const along = [Math.cos(turn), Math.sin(turn)];
      const up = [Math.sin(turn), -Math.cos(turn)];
      // The line's own width, measured along it.
      const length = firstPiece.width;
      const middle = [
        firstPiece.x + along[0] * (length / 2) + up[0] * (size * ASCENT - height / 2),
        firstPiece.baseline + along[1] * (length / 2) + up[1] * (size * ASCENT - height / 2),
      ];
      return { x: middle[0] - width / 2, y: middle[1] - height / 2, width, height, angle: firstPiece.angle, align: "l", spacing: 1, paragraphs };
    }
    const align = alignOf(group);
    const left = Math.min(...group.map((line) => line.x));
    const right = Math.max(...group.map((line) => line.right));
    const width = (right - left) * SPARE_WIDTH + size * 0.5;
    const extra = width - (right - left);
    const x = align === "l" ? left : align === "ctr" ? left - extra / 2 : left - extra;
    const top = first.baseline - first.size * ASCENT * spacing;
    const last = group[group.length - 1];
    const height = last.baseline - top + last.size * 0.3;
    const box: TextBox = { x, y: top, width, height, angle: 0, align, spacing: Math.round(spacing * 100) / 100, paragraphs };
    if (scanOf) {
      const { paper, ink } = scanOf({ x: left, y: top, width: right - left, height });
      box.fill = paper;
      for (const paragraph of paragraphs) for (const run of paragraph.runs) run.colour = ink;
    }
    return box;
  });
}
