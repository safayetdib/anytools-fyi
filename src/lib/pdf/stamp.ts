import { StandardFonts, rgb, type PDFPage } from "pdf-lib";

// Placing text and pictures on pages as they're shown, shared by Add page numbers and Add watermark.

// The fonts every PDF reader has built in: regular, bold, italic and bold italic of each.
export const FONTS = {
  helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
} as const;

// Latin letters, digits and the symbols those fonts can draw (Windows-1252).
const DRAWABLE = /^[\x20-\x7e\xa0-\xff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]*$/;

export function canDraw(text: string): boolean {
  return DRAWABLE.test(text);
}

export function colour(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

export // Turns a point measured on the page as shown into the page's own coordinates, and the angle text needs to look upright.
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

export function shownSize(page: PDFPage): [number, number] {
  const { width, height } = page.getCropBox();
  return page.getRotation().angle % 180 === 0 ? [width, height] : [height, width];
}
