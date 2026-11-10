import { PDFDocument, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { FONTS, canDraw, colour, drawTextPicture, shownSize, toPage, type TextPicture } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";

export interface Settings {
  mode: "single" | "facing";
  // With facing pages: the first page stands alone, like a book cover.
  cover: boolean;
  vertical: "top" | "middle" | "bottom";
  horizontal: "left" | "center" | "right";
  margin: "small" | "recommended" | "big";
  first: number;
  from: number;
  // null means the last page.
  to: number | null;
  text: "number" | "page" | "pageOf" | "custom";
  custom: string;
  // Bangla digits print ১, ২, ৩ instead of 1, 2, 3.
  digits: "latin" | "bangla";
  font: "helvetica" | "times" | "courier";
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "single",
  cover: false,
  vertical: "bottom",
  horizontal: "right",
  margin: "recommended",
  first: 1,
  from: 1,
  to: null,
  text: "number",
  custom: "Page {n} of {p}",
  digits: "latin",
  font: "helvetica",
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  color: "#000000",
};

// Distance from the page edge, in PDF points (1/72 inch).
export const MARGINS = { small: 10, recommended: 18, big: 36 } as const;
const MIN_SIZE = 6;
const MAX_SIZE = 72;

export class NumberError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "text") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

export function readSettings(text: string): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // No choices yet.
  }
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const whole = (value: unknown, fallback: number, min: number, max = Infinity) =>
    Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(Math.max(Math.round(Number(value)), min), max) : fallback;
  const d = DEFAULT_SETTINGS;
  return {
    mode: pick(raw.mode, ["single", "facing"], d.mode),
    cover: raw.cover === true,
    vertical: pick(raw.vertical, ["top", "middle", "bottom"], d.vertical),
    horizontal: pick(raw.horizontal, ["left", "center", "right"], d.horizontal),
    margin: pick(raw.margin, ["small", "recommended", "big"], d.margin),
    first: whole(raw.first, d.first, 0),
    from: whole(raw.from, d.from, 1),
    to: raw.to === null || raw.to === undefined || raw.to === "" ? null : whole(raw.to, 1, 1),
    text: pick(raw.text, ["number", "page", "pageOf", "custom"], d.text),
    custom: typeof raw.custom === "string" ? raw.custom.slice(0, 120) : d.custom,
    digits: pick(raw.digits, ["latin", "bangla"], d.digits),
    font: pick(raw.font, ["helvetica", "times", "courier"], d.font),
    size: whole(raw.size, d.size, MIN_SIZE, MAX_SIZE),
    bold: raw.bold === true,
    italic: raw.italic === true,
    underline: raw.underline === true,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : d.color,
  };
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function digitsOf(n: number, digits: Settings["digits"]): string {
  const text = String(n);
  return digits === "bangla" ? text.replace(/[0-9]/g, (digit) => BANGLA_DIGITS[Number(digit)]) : text;
}

function templateOf(settings: Settings): string {
  return { number: "{n}", page: "Page {n}", pageOf: "Page {n} of {p}", custom: settings.custom.trim() || "{n}" }[settings.text];
}

// The words printed on a page: {n} is its number, {p} the last number printed.
export function labelFor(settings: Settings, n: number, last: number): string {
  return templateOf(settings).replaceAll("{n}", digitsOf(n, settings.digits)).replaceAll("{p}", digitsOf(last, settings.digits));
}

// A label in pieces: each digit on its own, and the words between them. Digits never join with the letters beside them,
// so a handful of pieces drawn once can spell out every page's label.
export function piecesOf(label: string): string[] {
  return label.match(/[0-9০-৯]|[^0-9০-৯]+/gu) ?? [];
}

// Labels in Bangla, or with Bangla digits, are drawn in the page as pictures, since PDF's built-in fonts can't draw them.
export function needsPictures(settings: Settings): boolean {
  return settings.digits === "bangla" || !canDraw(templateOf(settings));
}

// Every piece any page's label can be made of: the template's words and all ten digits.
export function picturePieces(settings: Settings): string[] {
  const words = templateOf(settings).split(/\{[np]\}/).flatMap(piecesOf);
  const digits = Array.from({ length: 10 }, (_, digit) => digitsOf(digit, settings.digits));
  return [...new Set([...words, ...digits])];
}

// Which pages get a number, and which number. Pages outside "from" to "to" are left alone.
export function numbering(settings: Settings, pageCount: number) {
  const from = Math.min(settings.from, pageCount + 1);
  const to = Math.min(settings.to ?? pageCount, pageCount);
  const pages: { page: number; n: number }[] = [];
  for (let page = from; page <= to; page++) pages.push({ page, n: settings.first + (page - from) });
  return { pages, last: settings.first + Math.max(0, to - from) };
}

// In a spread, odd pages sit on the left; after a cover page, even ones do.
export function onLeft(page: number, settings: Settings): boolean {
  if (settings.mode !== "facing") return false;
  return settings.cover ? page % 2 === 0 : page % 2 === 1;
}

// Where text of textWidth × textHeight starts, from the bottom left of a page shown width × height.
export function place(width: number, height: number, textWidth: number, textHeight: number, settings: Settings, left: boolean) {
  const margin = MARGINS[settings.margin];
  // On the left page of a spread, numbers go to the outer edge, so left and right swap.
  const horizontal = left && settings.horizontal !== "center" ? (settings.horizontal === "left" ? "right" : "left") : settings.horizontal;
  const x = { left: margin, center: (width - textWidth) / 2, right: width - margin - textWidth }[horizontal];
  const y = { bottom: margin, middle: (height - textHeight) / 2, top: height - margin - textHeight }[settings.vertical];
  return { x, y };
}

// Draws a label in the built-in font, or piece by piece from pictures.
type Writer =
  | { kind: "font"; font: PDFFont }
  | { kind: "pictures"; pictures: Record<string, TextPicture>; embedded: Map<string, PDFImage> };

function drawLabel(page: PDFPage, writer: Writer, label: string, settings: Settings, left: boolean) {
  const size = settings.size;
  const pieces = writer.kind === "pictures" ? piecesOf(label).map((piece) => ({ piece, picture: writer.pictures[piece] })) : [];
  const textWidth = writer.kind === "font" ? writer.font.widthOfTextAtSize(label, size) : pieces.reduce((sum, { picture }) => sum + picture.width, 0);
  const textHeight = writer.kind === "font" ? writer.font.heightAtSize(size, { descender: false }) : Math.max(...pieces.map(({ picture }) => picture.ascent));
  const [width, height] = shownSize(page);
  const spot = place(width, height, textWidth, textHeight, settings, left);
  const color = colour(settings.color);
  if (writer.kind === "font") {
    const start = toPage(page, spot.x, spot.y);
    page.drawText(label, { x: start.x, y: start.y, size, font: writer.font, color, rotate: degrees(start.angle) });
  } else {
    let x = spot.x;
    for (const { piece, picture } of pieces) {
      drawTextPicture(page, writer.embedded.get(piece) as PDFImage, picture, { x, y: spot.y }, 0);
      x += picture.width;
    }
  }
  if (settings.underline) {
    const under = Math.max(1, size * 0.12);
    const from = toPage(page, spot.x, spot.y - under);
    const to = toPage(page, spot.x + textWidth, spot.y - under);
    page.drawLine({ start: { x: from.x, y: from.y }, end: { x: to.x, y: to.y }, thickness: Math.max(0.5, size * 0.06), color });
  }
}

// `pictures` holds every piece from picturePieces, drawn in the page, for labels the built-in fonts can't draw.
export async function numberPdf(bytes: Uint8Array, settings: Settings, pictures?: Record<string, TextPicture>): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new NumberError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const { pages, last } = numbering(settings, document.getPageCount());
  const labels = pages.map(({ n }) => labelFor(settings, n, last));
  let writer: Writer;
  if (needsPictures(settings)) {
    // Every piece must have its picture before any page changes. Each picture goes into the file once.
    const used = new Set(labels.flatMap(piecesOf));
    if (!pictures || [...used].some((piece) => !pictures[piece])) throw new NumberError("text");
    const embedded = new Map<string, PDFImage>();
    for (const piece of used) embedded.set(piece, await document.embedPng(pictures[piece].bytes));
    writer = { kind: "pictures", pictures, embedded };
  } else {
    const font = await document.embedFont(FONTS[settings.font][(settings.bold ? 1 : 0) + (settings.italic ? 2 : 0)]);
    // The built-in fonts draw Latin letters, digits and common symbols; anything else is refused before any change.
    try {
      labels.forEach((label) => font.encodeText(label));
    } catch {
      throw new NumberError("text");
    }
    writer = { kind: "font", font };
  }
  pages.forEach(({ page }, index) => drawLabel(document.getPage(page - 1), writer, labels[index], settings, onLeft(page, settings)));
  return document.save();
}

// Like most PDF tools: "report.pdf" becomes "report_pagenumber.pdf".
export function numberedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_pagenumber.pdf`;
}
