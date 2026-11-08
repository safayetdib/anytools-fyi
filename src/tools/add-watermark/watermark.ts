import { PDFDocument, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { FONTS, canDraw, colour, shownSize, toPage } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";

export interface Settings {
  kind: "text" | "image";
  text: string;
  font: "helvetica" | "times" | "courier";
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  vertical: "top" | "middle" | "bottom";
  horizontal: "left" | "center" | "right";
  // Repeat it across the whole page, ignoring the position.
  mosaic: boolean;
  // How see-through it is: 75 draws it at a quarter of its strength.
  transparency: 0 | 25 | 50 | 75;
  // Anticlockwise, around its own centre.
  rotation: 0 | 45 | 90 | 180 | 270;
  from: number;
  // null means the last page.
  to: number | null;
  layer: "over" | "below";
}

export interface WatermarkImage {
  bytes: Uint8Array;
  kind: "png" | "jpg";
}

export const DEFAULT_SETTINGS: Settings = {
  kind: "text",
  text: "CONFIDENTIAL",
  font: "helvetica",
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  color: "#000000",
  vertical: "top",
  horizontal: "left",
  mosaic: false,
  transparency: 0,
  rotation: 0,
  from: 1,
  to: null,
  layer: "over",
};

// Distance from the page edge, in PDF points (1/72 inch).
export const MARGIN = 18;
const MIN_SIZE = 6;
const MAX_SIZE = 200;
// Screens show images at 96 pixels per inch; PDF pages are measured at 72 points per inch.
const POINTS_PER_PIXEL = 72 / 96;
// An image larger than this share of the page is shrunk to fit.
const MAX_IMAGE_SHARE = 0.5;

export class WatermarkError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "text" | "image") {
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
  const pick = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  const whole = (value: unknown, fallback: number, min: number, max = Infinity) =>
    Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(Math.max(Math.round(Number(value)), min), max) : fallback;
  const d = DEFAULT_SETTINGS;
  return {
    kind: pick(raw.kind, ["text", "image"], d.kind),
    text: typeof raw.text === "string" ? raw.text.slice(0, 120) : d.text,
    font: pick(raw.font, ["helvetica", "times", "courier"], d.font),
    size: whole(raw.size, d.size, MIN_SIZE, MAX_SIZE),
    bold: raw.bold === true,
    italic: raw.italic === true,
    underline: raw.underline === true,
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : d.color,
    vertical: pick(raw.vertical, ["top", "middle", "bottom"], d.vertical),
    horizontal: pick(raw.horizontal, ["left", "center", "right"], d.horizontal),
    mosaic: raw.mosaic === true,
    transparency: pick(Number(raw.transparency), [0, 25, 50, 75] as const, d.transparency),
    rotation: pick(Number(raw.rotation), [0, 45, 90, 180, 270] as const, d.rotation),
    from: whole(raw.from, d.from, 1),
    to: raw.to === null || raw.to === undefined || raw.to === "" ? null : whole(raw.to, 1, 1),
    layer: pick(raw.layer, ["over", "below"], d.layer),
  };
}

// The space a width × height box takes once turned by `rotation` degrees.
export function turnedSize(width: number, height: number, rotation: number) {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return { width: width * cos + height * sin, height: width * sin + height * cos };
}

// The centre of the watermark in its spot, measured on the page as shown, keeping its turned box inside the margins.
export function centreFor(pageWidth: number, pageHeight: number, width: number, height: number, settings: Settings) {
  const box = turnedSize(width, height, settings.rotation);
  const x = { left: MARGIN + box.width / 2, center: pageWidth / 2, right: pageWidth - MARGIN - box.width / 2 }[settings.horizontal];
  const y = { bottom: MARGIN + box.height / 2, middle: pageHeight / 2, top: pageHeight - MARGIN - box.height / 2 }[settings.vertical];
  return { x, y };
}

// Centres for Mosaic: rows and columns across the page, with room between each copy.
export function mosaicCentres(pageWidth: number, pageHeight: number, width: number, height: number, rotation = 0) {
  const box = turnedSize(width, height, rotation);
  const stepX = box.width + Math.max(36, box.width * 0.5);
  const stepY = box.height + Math.max(48, box.height * 1.5);
  const centres: { x: number; y: number }[] = [];
  for (let y = MARGIN + box.height / 2; y < pageHeight; y += stepY) {
    for (let x = MARGIN + box.width / 2; x < pageWidth; x += stepX) centres.push({ x, y });
  }
  return centres;
}

// Where to start drawing so a width × height box, turned anticlockwise, is centred on `centre`.
function startFor(centre: { x: number; y: number }, width: number, height: number, rotation: number) {
  const angle = (rotation * Math.PI) / 180;
  return {
    x: centre.x - (width / 2) * Math.cos(angle) + (height / 2) * Math.sin(angle),
    y: centre.y - (width / 2) * Math.sin(angle) - (height / 2) * Math.cos(angle),
  };
}

interface Mark {
  width: number;
  height: number;
  draw(page: PDFPage, start: { x: number; y: number }, rotation: number): void;
}

function textMark(font: PDFFont, settings: Settings): Mark {
  const size = settings.size;
  const width = font.widthOfTextAtSize(settings.text, size);
  const height = font.heightAtSize(size, { descender: false });
  const color = colour(settings.color);
  const opacity = 1 - settings.transparency / 100;
  return {
    width,
    height,
    draw(page, start, rotation) {
      const at = toPage(page, start.x, start.y);
      page.drawText(settings.text, { x: at.x, y: at.y, size, font, color, opacity, rotate: degrees(at.angle + rotation) });
      if (!settings.underline) return;
      // The underline turns with the text: measured along its baseline, just below it.
      const angle = (rotation * Math.PI) / 180;
      const under = Math.max(1, size * 0.12);
      const lineStart = { x: start.x + under * Math.sin(angle), y: start.y - under * Math.cos(angle) };
      const lineEnd = { x: lineStart.x + width * Math.cos(angle), y: lineStart.y + width * Math.sin(angle) };
      const from = toPage(page, lineStart.x, lineStart.y);
      const to = toPage(page, lineEnd.x, lineEnd.y);
      page.drawLine({ start: { x: from.x, y: from.y }, end: { x: to.x, y: to.y }, thickness: Math.max(0.5, size * 0.06), color, opacity });
    },
  };
}

function imageMark(image: PDFImage, pageWidth: number, pageHeight: number, settings: Settings): Mark {
  const scale = Math.min(POINTS_PER_PIXEL, (pageWidth * MAX_IMAGE_SHARE) / image.width, (pageHeight * MAX_IMAGE_SHARE) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const opacity = 1 - settings.transparency / 100;
  return {
    width,
    height,
    draw(page, start, rotation) {
      const at = toPage(page, start.x, start.y);
      page.drawImage(image, { x: at.x, y: at.y, width, height, opacity, rotate: degrees(at.angle + rotation) });
    },
  };
}

function stamp(page: PDFPage, mark: Mark, settings: Settings) {
  const [pageWidth, pageHeight] = shownSize(page);
  const centres = settings.mosaic
    ? mosaicCentres(pageWidth, pageHeight, mark.width, mark.height, settings.rotation)
    : [centreFor(pageWidth, pageHeight, mark.width, mark.height, settings)];
  for (const centre of centres) mark.draw(page, startFor(centre, mark.width, mark.height, settings.rotation), settings.rotation);
  // Below the content: the watermark's drawing moves to the start, so the page's own text and pictures sit on top.
  if (settings.layer === "below") {
    const contents = page.node.normalizedEntries().Contents;
    if (!contents) return;
    const last = contents.size() - 1;
    const added = contents.get(last);
    contents.remove(last);
    contents.insert(0, added);
  }
}

export async function watermarkPdf(bytes: Uint8Array, settings: Settings, image?: WatermarkImage): Promise<Uint8Array> {
  if (settings.kind === "text" && !canDraw(settings.text)) throw new WatermarkError("text");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new WatermarkError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  let embedded: PDFImage | null = null;
  let font: PDFFont | null = null;
  if (settings.kind === "image") {
    if (!image) throw new WatermarkError("image");
    embedded = image.kind === "png" ? await document.embedPng(image.bytes) : await document.embedJpg(image.bytes);
  } else {
    font = await document.embedFont(FONTS[settings.font][(settings.bold ? 1 : 0) + (settings.italic ? 2 : 0)]);
  }
  const count = document.getPageCount();
  const to = Math.min(settings.to ?? count, count);
  for (let number = Math.min(settings.from, count + 1); number <= to; number++) {
    const page = document.getPage(number - 1);
    const [pageWidth, pageHeight] = shownSize(page);
    const mark = embedded ? imageMark(embedded, pageWidth, pageHeight, settings) : textMark(font as PDFFont, settings);
    stamp(page, mark, settings);
  }
  return document.save();
}

// Like most PDF tools: "report.pdf" becomes "report_watermark.pdf".
export function watermarkedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_watermark.pdf`;
}
