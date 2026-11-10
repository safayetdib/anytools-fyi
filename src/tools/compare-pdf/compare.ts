import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { canDraw, shownSize } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";
import { shownToPage } from "../edit-pdf/edit";

// A word on a page as shown, from its top-left corner, as fractions of the page.
export interface Word {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class CompareError extends JobError {
  constructor(code: "encrypted" | "unreadable", detail?: string) {
    super(code, detail);
  }
}

// Past this many edits between the two texts, the rest of the middle counts as changed: comparing further would take
// too long and too much memory on a phone, and the documents are mostly different anyway.
const MAX_EDITS = 4000;

// Which words of `before` were removed and which words of `after` were added, by their places in the lists, using the
// shortest way to turn one into the other (Myers' method).
export function diffWords(before: string[], after: string[]): { removed: number[]; added: number[] } {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  const n = a.length;
  const m = b.length;
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);
  if (!n || !m) return { removed: range(start, endBefore), added: range(start, endAfter) };

  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 1);
  // What each diagonal reached after each number of edits, kept to trace the way back.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(n + m, MAX_EDITS); d++) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return { removed: range(start, endBefore), added: range(start, endAfter) };

  const removed: number[] = [];
  const added: number[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    // What the diagonals reached before this edit; diagonal k sits at k + d in it.
    const previous = trace[d];
    const at = (k: number) => previous[k + d];
    const k = x - y;
    const fromK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const fromX = at(fromK);
    const fromY = fromX - fromK;
    if (fromK === k + 1) added.push(start + fromY);
    else removed.push(start + fromX);
    x = fromX;
    y = fromY;
  }
  return { removed: removed.reverse(), added: added.reverse() };
}

// Words for comparing: the same word with different spacing or punctuation around it still matches.
export function normalise(text: string): string {
  return text.normalize("NFC").replace(/^[\s"'“”‘’(\[{]+|[\s"'“”‘’)\]},.;:!?]+$/g, "");
}

// Room around the pages and above them for their labels, in points.
const MARGIN = 24;
const LABEL = 22;
const GAP = 24;
const RED = rgb(0.95, 0.35, 0.35);
const GREEN = rgb(0.3, 0.8, 0.45);

// The inverse of an affine transform [a b c d e f].
function inverse([a, b, c, d, e, f]: number[]): [number, number, number, number, number, number] {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

async function open(bytes: Uint8Array, which: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new CompareError(/is encrypted/i.test(String((error as Error)?.message)) ? "encrypted" : "unreadable", which);
  }
}

// Draws a page as it's shown, scaled into a box on the sheet, with its changed words highlighted.
async function place(sheet: PDFPage, output: PDFDocument, page: PDFPage, box: { x: number; y: number; scale: number }, marks: Word[], colour: typeof RED) {
  const [width, height] = shownSize(page);
  sheet.pushOperators(pushGraphicsState(), concatTransformationMatrix(box.scale, 0, 0, box.scale, box.x, box.y));
  if (page.node.Contents()) {
    const crop = page.getCropBox();
    const embedded = await output.embedPage(page, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
    sheet.pushOperators(pushGraphicsState(), concatTransformationMatrix(...inverse(shownToPage(page))));
    sheet.drawPage(embedded, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
    sheet.pushOperators(popGraphicsState());
  }
  for (const word of marks) {
    sheet.drawRectangle({
      x: word.x * width - 1,
      y: height - (word.y + word.height) * height - 1,
      width: word.width * width + 2,
      height: word.height * height + 2,
      color: colour,
      opacity: 0.55,
      blendMode: BlendMode.Multiply,
    });
  }
  sheet.drawRectangle({ x: 0, y: 0, width, height, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.75 / box.scale });
  sheet.pushOperators(popGraphicsState());
}

// One sheet for each pair of pages: the original on the left with removed words in red, the changed one on the right
// with added words in green. A page only one of them has sits beside an empty space.
export async function buildComparison(
  before: { name: string; bytes: Uint8Array; removed: Word[] },
  after: { name: string; bytes: Uint8Array; added: Word[] },
  labels: { before: string; after: string },
): Promise<Uint8Array> {
  const [left, right] = [await open(before.bytes, "before"), await open(after.bytes, "after")];
  const output = await PDFDocument.create();
  const font = await output.embedFont(StandardFonts.HelveticaBold);
  const count = Math.max(left.getPageCount(), right.getPageCount());
  for (let index = 0; index < count; index++) {
    const pages = [left.getPages()[index], right.getPages()[index]];
    const sizes = pages.map((page) => (page ? shownSize(page) : null));
    const known = sizes.find(Boolean) as [number, number];
    const [leftSize, rightSize] = sizes.map((size) => size ?? known);
    // Both pages at the same height, so lines can be compared across.
    const height = Math.max(leftSize[1], rightSize[1]);
    const scales = [height / leftSize[1], height / rightSize[1]];
    const widths = [leftSize[0] * scales[0], rightSize[0] * scales[1]];
    const sheet = output.addPage([MARGIN * 2 + widths[0] + GAP + widths[1], MARGIN * 2 + LABEL + height]);
    const xs = [MARGIN, MARGIN + widths[0] + GAP];
    const label = (text: string, x: number, maxWidth: number, writer: PDFFont) => {
      let shown = text;
      while (shown.length > 4 && writer.widthOfTextAtSize(shown, 10) > maxWidth) shown = `${shown.slice(0, -2)}…`;
      sheet.drawText(shown, { x, y: MARGIN + height + 8, size: 10, font: writer, color: rgb(0.2, 0.2, 0.2) });
    };
    const titles = [
      canDraw(before.name) ? `${labels.before}: ${before.name}` : labels.before,
      canDraw(after.name) ? `${labels.after}: ${after.name}` : labels.after,
    ];
    for (const side of [0, 1]) {
      label(titles[side], xs[side], widths[side], font);
      const page = pages[side];
      if (!page) continue;
      const marks = side === 0 ? before.removed.filter((word) => word.page === index + 1) : after.added.filter((word) => word.page === index + 1);
      await place(sheet, output, page, { x: xs[side], y: MARGIN, scale: scales[side] }, marks, side === 0 ? RED : GREEN);
    }
  }
  return output.save();
}

// "contract-v2.pdf" compared becomes "contract-v2_compared.pdf".
export function comparedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_compared.pdf`;
}
