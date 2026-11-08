import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
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
    font: pick(raw.font, ["helvetica", "times", "courier"], d.font),
    size: whole(raw.size, d.size, MIN_SIZE, MAX_SIZE),
    bold: raw.bold === true,
    italic: raw.italic === true,
    underline: raw.underline === true,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : d.color,
  };
}

// The words printed on a page: {n} is its number, {p} the last number printed.
export function labelFor(settings: Settings, n: number, last: number): string {
  const template = { number: "{n}", page: "Page {n}", pageOf: "Page {n} of {p}", custom: settings.custom.trim() || "{n}" }[settings.text];
  return template.replaceAll("{n}", String(n)).replaceAll("{p}", String(last));
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

const FONTS = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
} as const;

function colour(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

// Turns a point measured on the page as shown into the page's own coordinates, and the angle text needs to look upright.
function toPage(page: PDFPage, x: number, y: number) {
  const box = page.getCropBox();
  const turn = ((page.getRotation().angle % 360) + 360) % 360;
  const points = {
    0: { x, y, angle: 0 },
    90: { x: box.width - y, y: x, angle: 90 },
    180: { x: box.width - x, y: box.height - y, angle: 180 },
    270: { x: y, y: box.height - x, angle: 270 },
  }[turn as 0 | 90 | 180 | 270];
  return { x: box.x + points.x, y: box.y + points.y, angle: points.angle };
}

function shownSize(page: PDFPage): [number, number] {
  const { width, height } = page.getCropBox();
  return page.getRotation().angle % 180 === 0 ? [width, height] : [height, width];
}

function drawLabel(page: PDFPage, font: PDFFont, label: string, settings: Settings, left: boolean) {
  const size = settings.size;
  const textWidth = font.widthOfTextAtSize(label, size);
  const textHeight = font.heightAtSize(size, { descender: false });
  const [width, height] = shownSize(page);
  const spot = place(width, height, textWidth, textHeight, settings, left);
  const start = toPage(page, spot.x, spot.y);
  const color = colour(settings.color);
  page.drawText(label, { x: start.x, y: start.y, size, font, color, rotate: degrees(start.angle) });
  if (settings.underline) {
    const under = Math.max(1, size * 0.12);
    const from = toPage(page, spot.x, spot.y - under);
    const to = toPage(page, spot.x + textWidth, spot.y - under);
    page.drawLine({ start: { x: from.x, y: from.y }, end: { x: to.x, y: to.y }, thickness: Math.max(0.5, size * 0.06), color });
  }
}

export async function numberPdf(bytes: Uint8Array, settings: Settings): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new NumberError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const font = await document.embedFont(FONTS[settings.font][(settings.bold ? 1 : 0) + (settings.italic ? 2 : 0)]);
  const { pages, last } = numbering(settings, document.getPageCount());
  const labels = pages.map(({ n }) => labelFor(settings, n, last));
  // The built-in fonts draw Latin letters, digits and common symbols; anything else is refused before any change.
  try {
    labels.forEach((label) => font.encodeText(label));
  } catch {
    throw new NumberError("text");
  }
  pages.forEach(({ page }, index) => drawLabel(document.getPage(page - 1), font, labels[index], settings, onLeft(page, settings)));
  return document.save();
}

// Like most PDF tools: "report.pdf" becomes "report_pagenumber.pdf".
export function numberedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_pagenumber.pdf`;
}
