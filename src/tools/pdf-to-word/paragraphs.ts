import { buildLines, type Line } from "../../lib/pdf/lines";
import type { FontStyle, PageContent, PicturePlace } from "../../lib/pdf/page-content";

// Turns a page's lines into paragraphs Word can let flow again, with their spacing, indents and alignment, so the
// document is easy to edit and still looks like the PDF. Kept apart from pdf.js so it can be tested alone.

export interface Run {
  // Tabs mark where a column starts.
  text: string;
  font: FontStyle;
  size: number;
}

export interface Paragraph {
  kind: "text";
  runs: Run[];
  align: "left" | "center" | "right" | "both";
  // In points: from the page's text margin, and for the first line, from the rest of the paragraph.
  indent: number;
  firstLine: number;
  rightIndent: number;
  // Space above the paragraph, in points, and how far apart its lines are, as a multiple of single spacing.
  before: number;
  lineSpacing: number;
  // Tab stops, in points from the text margin.
  tabs: number[];
}

export interface PictureBlock {
  kind: "picture";
  place: PicturePlace;
  width: number;
  height: number;
  indent: number;
  before: number;
}

export type Block = Paragraph | PictureBlock;

export interface PageLayout {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  blocks: Block[];
  // Pictures that sit behind the text, like a letterhead's background, kept where they are on the page.
  behind: PicturePlace[];
}

// Lines further apart than this many letter sizes belong to different paragraphs.
const PARAGRAPH_GAP = 1.75;
// A picture filling this share of the page, with text over it, is a background.
const BACKGROUND_SHARE = 0.45;
// Word's single line spacing, as a multiple of the letter size, and where the letters sit in that line.
const SINGLE_LINE = 1.17;
const ASCENT = 0.92;
const DESCENT = 0.25;
// Lists start with a bullet, a dash or a number or letter and a stop.
const LIST_MARK = /^([•●▪◦‣∙·○■□➢➤►✓✔*–\u2014-]|\(?(\d{1,3}|[a-zA-Z]|[ivxIVX]{1,4}|[০-৯]{1,3})[.)])\s/;

const allBold = (line: Line) => line.pieces.every((piece) => piece.font.bold);
const spread = (values: number[]) => (values.length ? Math.max(...values) - Math.min(...values) : 0);
const overlaps = (a: { y: number; height: number; x: number; width: number }, line: Line) =>
  line.baseline > a.y && line.baseline - line.size < a.y + a.height && line.right > a.x && line.x < a.x + a.width;

// The first word of a line, and roughly how wide it is.
function firstWordWidth(line: Line): number {
  const piece = line.pieces[0];
  const word = /^\S+/.exec(piece.text)?.[0] ?? piece.text;
  return (word.length / Math.max(1, piece.text.length)) * piece.width;
}

// Whether `line` carries on the paragraph that `lines` started.
function continues(lines: Line[], line: Line): boolean {
  const previous = lines[lines.length - 1];
  const size = Math.max(previous.size, line.size);
  const step = line.baseline - previous.baseline;
  if (line.columns || previous.columns) return false;
  if (step <= 0 || step > size * PARAGRAPH_GAP) return false;
  if (Math.abs(line.size - previous.size) > previous.size * 0.2) return false;
  // A line all in bold, like a heading, stands apart from text with only some words in bold.
  if (allBold(line) !== allBold(previous)) return false;
  if (LIST_MARK.test(line.text)) return false;
  if (line.right < Math.min(...lines.map((l) => l.x)) || line.x > Math.max(...lines.map((l) => l.right))) return false;
  // A line stops early when the paragraph ends there: the next line's first word would have fitted after it.
  const word = firstWordWidth(line) + previous.size * 0.3;
  // Lines that start in the same place, or after a first line set in from the rest.
  const leftAligned = Math.abs(line.x - previous.x) < size || (lines.length === 1 && line.x < previous.x && previous.x - line.x < size * 4);
  if (leftAligned) {
    const right = Math.max(line.right, ...lines.map((l) => l.right));
    return previous.right + word >= right - size * 0.5;
  }
  const widest = Math.max(line.right - line.x, ...lines.map((l) => l.right - l.x));
  return previous.right - previous.x + word >= widest - size * 0.5;
}

const runKey = (run: Run) => `${run.font.family}|${run.font.bold}|${run.font.italic}|${run.size}`;

function runsOf(lines: Line[]): Run[] {
  const runs: Run[] = [];
  const add = (text: string, font: FontStyle, size: number) => {
    const run = { text, font, size: Math.round(size * 2) / 2 };
    const last = runs[runs.length - 1];
    if (last && runKey(last) === runKey(run)) last.text += text;
    else if (last && !text.trim()) last.text += text;
    else runs.push(run);
  };
  for (const [index, line] of lines.entries()) {
    for (const [at, piece] of line.pieces.entries()) {
      let prefix = piece.gap === "space" ? " " : piece.gap === "column" ? "\t" : "";
      if (at === 0 && index > 0) {
        const last = runs[runs.length - 1];
        // A word broken across lines with a hyphen is joined again.
        if (last && /\p{Ll}[-\u2010\u00AD]$/u.test(last.text) && /^\p{Ll}/u.test(piece.text)) {
          last.text = last.text.slice(0, -1);
          prefix = "";
        } else prefix = " ";
      }
      add(prefix + piece.text, piece.font, piece.size);
    }
  }
  return runs;
}

function alignOf(lines: Line[], content: { left: number; right: number }): Paragraph["align"] {
  const size = Math.max(...lines.map((line) => line.size));
  const lefts = lines.map((line) => line.x);
  const rights = lines.map((line) => line.right);
  const centres = lines.map((line) => (line.x + line.right) / 2);
  if (lines.length === 1) {
    const [line] = lines;
    const middle = (content.left + content.right) / 2;
    if (line.x - content.left > size * 2 && Math.abs(centres[0] - middle) < size) return "center";
    if (line.x - content.left > (content.right - content.left) * 0.4 && content.right - line.right < size * 0.5) return "right";
    return "left";
  }
  if (spread(lefts) > size && spread(centres) < size * 0.6) return "center";
  if (spread(lefts.slice(1)) > size && spread(rights) < size * 0.5) return "right";
  if (lines.length >= 3 && spread(rights.slice(0, -1)) < size * 0.35) return "both";
  return "left";
}

// The page as Word paragraphs and pictures. Pages that are a scan with hidden text behind them, as OCR makes, keep
// only the text, so it can be edited.
export function layoutPage(content: PageContent): PageLayout {
  const lines = buildLines(content.pieces);
  const pageArea = content.width * content.height;
  const behind: PicturePlace[] = [];
  const flowing: PicturePlace[] = [];
  for (const picture of content.pictures) {
    const big = picture.width * picture.height >= pageArea * BACKGROUND_SHARE;
    if (big && content.hiddenText) continue;
    if (big && lines.some((line) => overlaps(picture, line))) behind.push(picture);
    else flowing.push(picture);
  }
  const boxes = [...lines.map((line) => ({ left: line.x, right: line.right })), ...flowing.map((p) => ({ left: p.x, right: p.x + p.width }))];
  const content_ = boxes.length
    ? { left: Math.max(0, Math.min(...boxes.map((b) => b.left))), right: Math.min(content.width, Math.max(...boxes.map((b) => b.right))) }
    : { left: 72, right: content.width - 72 };
  // Word needs room for text, so a page with text in a thin strip still gets a sensible width.
  const left = Math.min(content_.left, content.width * 0.3);
  const right = Math.max(0, Math.min(content.width - content_.right, content.width * 0.3));
  const textWidth = content.width - left - right;

  // Lines into paragraphs, in reading order.
  const groups: Line[][] = [];
  for (const line of lines) {
    const group = groups[groups.length - 1];
    if (group && continues(group, line)) group.push(line);
    else groups.push([line]);
  }

  type Placed = { block: Block; top: number; bottom: number };
  const placed: Placed[] = groups.map((group) => {
    const size = group[0].size;
    const align = alignOf(group, content_);
    const rest = group.length > 1 ? group.slice(1) : group;
    const paraLeft = Math.min(...rest.map((line) => line.x));
    const paraRight = Math.max(...group.map((line) => line.right));
    const steps = group.slice(1).map((line, index) => line.baseline - group[index].baseline);
    const lineSpacing = steps.length ? Math.min(3, Math.max(0.8, steps.reduce((a, b) => a + b, 0) / steps.length / (size * SINGLE_LINE))) : 1;
    const flows = align === "left" || align === "both";
    const tabs = group[0].columns ? group[0].pieces.filter((piece) => piece.gap === "column").map((piece) => piece.x - left) : [];
    const paragraph: Paragraph = {
      kind: "text",
      runs: runsOf(group),
      align,
      indent: flows ? Math.max(0, paraLeft - left) : 0,
      firstLine: flows ? group[0].x - paraLeft : 0,
      rightIndent:
        align === "right" ? Math.max(0, content_.right - paraRight) : flows && group.length > 1 && content_.right - paraRight > size * 2 ? content_.right - paraRight : 0,
      before: 0,
      lineSpacing: Math.round(lineSpacing * 100) / 100,
      tabs,
    };
    const last = group[group.length - 1];
    return { block: paragraph, top: group[0].baseline - group[0].size * ASCENT, bottom: last.baseline + last.size * DESCENT };
  });

  // Pictures go in among the paragraphs where they sit on the page.
  for (const picture of [...flowing].sort((a, b) => a.y - b.y)) {
    const scale = Math.min(1, textWidth / picture.width);
    const width = picture.width * scale;
    const height = picture.height * scale;
    const indent = Math.max(0, Math.min(picture.x - left, textWidth - width));
    const block: PictureBlock = { kind: "picture", place: picture, width, height, indent, before: 0 };
    const at = placed.findIndex((item) => item.top >= picture.y - 1);
    const entry = { block, top: picture.y, bottom: picture.y + height };
    if (at < 0) placed.push(entry);
    else placed.splice(at, 0, entry);
  }

  let previous: Placed | null = null;
  for (const item of placed) {
    if (previous) item.block.before = Math.max(0, Math.round((item.top - previous.bottom) * 10) / 10);
    previous = item;
  }
  const first = placed[0];
  const lowest = Math.max(0, ...placed.map((item) => item.bottom));
  return {
    width: content.width,
    height: content.height,
    margins: {
      top: first ? Math.max(0, Math.min(first.top, content.height * 0.5)) : 72,
      right,
      // A little room at the foot, so text that sets slightly larger in Word still fits the page.
      bottom: Math.max(0, Math.min(18, content.height - lowest)),
      left,
    },
    blocks: placed.map((item) => item.block),
    behind,
  };
}

