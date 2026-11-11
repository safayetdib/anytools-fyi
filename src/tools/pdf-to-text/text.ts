// Turning a PDF's pieces of text into plain text, in reading order. Kept apart from pdf.js so it can be tested alone.

export interface Piece {
  str: string;
  // pdf.js marks the last piece of each line.
  hasEOL: boolean;
  // Where the piece's baseline is, in points from the page's bottom, and its letter size.
  y: number;
  size: number;
}

// A gap between lines taller than this many lines starts a new paragraph.
const PARAGRAPH_GAP = 1.6;

// One page's text: lines as the PDF breaks them, with a blank line where the PDF leaves a paragraph's space.
export function pageText(pieces: Piece[]): string {
  let text = "";
  let lineY: number | null = null;
  let lineSize = 0;
  let atLineStart = true;
  for (const piece of pieces) {
    if (atLineStart && lineY !== null && piece.str.trim()) {
      const gap = Math.abs(lineY - piece.y);
      if (gap > Math.max(lineSize, piece.size) * PARAGRAPH_GAP) text += "\n";
    }
    if (piece.str) {
      if (atLineStart) {
        lineY = piece.y;
        lineSize = piece.size;
      }
      text += piece.str;
      atLineStart = false;
    }
    // pdf.js also ends lines with empty pieces; a line break with nothing before it is skipped, and paragraphs come
    // from the gaps between lines instead.
    if (piece.hasEOL && !atLineStart) {
      text += "\n";
      atLineStart = true;
    }
  }
  // Spaces at the ends of lines, and more than one blank line, add nothing.
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The whole document: pages in order, each started by a marker line when asked for.
export function documentText(pages: string[], marker: ((page: number) => string) | null): string {
  const parts = pages.map((text, index) => (marker ? `${marker(index + 1)}\n\n${text}`.trim() : text)).filter((part) => part.trim());
  return `${parts.join("\n\n")}\n`;
}

export function hasAnyText(pages: string[]): boolean {
  return pages.some((page) => page.trim().length > 0);
}

// Like most PDF tools: "report.pdf" becomes "report.txt".
export function textName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}.txt`;
}
