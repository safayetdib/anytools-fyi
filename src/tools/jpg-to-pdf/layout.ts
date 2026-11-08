import { PDFDocument, PageSizes, degrees } from "pdf-lib";

export interface Settings {
  size: "fit" | "a4" | "letter";
  orientation: "portrait" | "landscape";
  margin: "none" | "small" | "big";
  merge: boolean;
}

export interface PreparedImage {
  bytes: Uint8Array;
  kind: "jpg" | "png";
  // Extra quarter turns clockwise, chosen on the image's card.
  rotate: number;
}

export const DEFAULT_SETTINGS: Settings = { size: "a4", orientation: "portrait", margin: "none", merge: true };
// Small is about 7 mm and Big about 18 mm, in PDF points (1/72 inch).
const MARGINS = { none: 0, small: 20, big: 50 } as const;
// Screens show images at 96 pixels per inch; PDF pages are measured at 72 points per inch.
const POINTS_PER_PIXEL = 72 / 96;
const SHEETS = { a4: PageSizes.A4, letter: PageSizes.Letter } as const;

// Reads the options panel's choices. Anything unexpected keeps the default, like other PDF tools start.
export function readSettings(text: string): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // No choices yet.
  }
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
  return {
    size: pick(raw.size, ["fit", "a4", "letter"], DEFAULT_SETTINGS.size),
    orientation: pick(raw.orientation, ["portrait", "landscape"], DEFAULT_SETTINGS.orientation),
    margin: pick(raw.margin, ["none", "small", "big"], DEFAULT_SETTINGS.margin),
    merge: typeof raw.merge === "boolean" ? raw.merge : DEFAULT_SETTINGS.merge,
  };
}

// The turn a camera saved in a JPG (EXIF orientation, 1 to 8). 1 means it's already the right way up.
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    // APP1 holding "Exif\0\0", then a TIFF header and the first list of tags.
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      const count = view.getUint16(ifd, little);
      for (let entry = 0; entry < count; entry++) {
        const at = ifd + 2 + entry * 12;
        if (at + 10 > bytes.length) break;
        if (view.getUint16(at, little) === 0x0112) return view.getUint16(at + 8, little) || 1;
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    offset += 2 + length;
  }
  return 1;
}

// HEIC and HEIF photos, as iPhones save them, start with an "ftyp" box naming one of these brands.
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export function isHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  return text(4, 8) === "ftyp" && HEIC_BRANDS.has(text(8, 12));
}

// Where an image of width × height pixels, turned by `rotate`, goes on its page.
export function pageLayout(width: number, height: number, rotate: number, settings: Settings) {
  const turned = rotate % 180 !== 0;
  const [shownWidth, shownHeight] = turned ? [height, width] : [width, height];
  const margin = MARGINS[settings.margin];
  if (settings.size === "fit") {
    const boxWidth = shownWidth * POINTS_PER_PIXEL;
    const boxHeight = shownHeight * POINTS_PER_PIXEL;
    return { page: [boxWidth + margin * 2, boxHeight + margin * 2] as [number, number], box: { x: margin, y: margin, width: boxWidth, height: boxHeight } };
  }
  const [short, long] = SHEETS[settings.size];
  const page: [number, number] = settings.orientation === "landscape" ? [long, short] : [short, long];
  const scale = Math.min((page[0] - margin * 2) / shownWidth, (page[1] - margin * 2) / shownHeight);
  const boxWidth = shownWidth * scale;
  const boxHeight = shownHeight * scale;
  return { page, box: { x: (page[0] - boxWidth) / 2, y: (page[1] - boxHeight) / 2, width: boxWidth, height: boxHeight } };
}

// One page per image, in order. Images are placed as they are, so nothing is re-compressed.
export async function buildPdf(images: PreparedImage[], settings: Settings): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const image of images) {
    const embedded = image.kind === "png" ? await document.embedPng(image.bytes) : await document.embedJpg(image.bytes);
    const rotate = ((image.rotate % 360) + 360) % 360;
    const { page: size, box } = pageLayout(embedded.width, embedded.height, rotate, settings);
    const page = document.addPage(size);
    // pdf-lib turns anticlockwise around the drawing point, so each clockwise turn moves that point to keep the image in its box.
    const turned = rotate % 180 !== 0;
    const width = turned ? box.height : box.width;
    const height = turned ? box.width : box.height;
    const origin = {
      0: { x: box.x, y: box.y },
      90: { x: box.x, y: box.y + box.height },
      180: { x: box.x + box.width, y: box.y + box.height },
      270: { x: box.x + box.width, y: box.y },
    }[rotate as 0 | 90 | 180 | 270];
    page.drawImage(embedded, { ...origin, width, height, rotate: degrees(-rotate) });
  }
  return document.save();
}

// Like most PDF tools: "photo.jpg" becomes "photo.pdf".
export function pdfName(original: string): string {
  return `${original.replace(/\.[^.]*$/, "") || "image"}.pdf`;
}
