import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PageSizes, concatTransformationMatrix, popGraphicsState, pushGraphicsState, type PDFPage } from "pdf-lib";
import { shownSize } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";
import { shownToPage } from "../edit-pdf/edit";

// Fits every page onto a sheet of one size, scaled to keep its shape and centred. One page to a sheet keeps the page
// itself, so links, form fields and comments come along; several to a sheet draws the pages small, side by side.

export class ResizeError extends JobError {
  constructor(code: "encrypted" | "unreadable") {
    super(code);
  }
}

export const SIZES = { a4: PageSizes.A4, letter: PageSizes.Letter, legal: PageSizes.Legal, a3: PageSizes.A3, a5: PageSizes.A5 } as const;
export const MARGINS = { none: 0, small: 18, big: 36 } as const;
export const PER_SHEET = [1, 2, 4, 6, 9] as const;

export interface ResizeSettings {
  size: keyof typeof SIZES;
  orientation: "auto" | "portrait" | "landscape";
  margin: keyof typeof MARGINS;
  perSheet: (typeof PER_SHEET)[number];
}

export const DEFAULT_SETTINGS: ResizeSettings = { size: "a4", orientation: "auto", margin: "none", perSheet: 1 };

export function readSettings(raw: Record<string, string | undefined>): ResizeSettings {
  const pick = <T extends string>(value: string | undefined, allowed: readonly T[], fallback: T) => (allowed.includes(value as T) ? (value as T) : fallback);
  const perSheet = Number(raw.perSheet);
  return {
    size: pick(raw.size, Object.keys(SIZES) as (keyof typeof SIZES)[], DEFAULT_SETTINGS.size),
    orientation: pick(raw.orientation, ["auto", "portrait", "landscape"] as const, DEFAULT_SETTINGS.orientation),
    margin: pick(raw.margin, Object.keys(MARGINS) as (keyof typeof MARGINS)[], DEFAULT_SETTINGS.margin),
    perSheet: (PER_SHEET as readonly number[]).includes(perSheet) ? (perSheet as ResizeSettings["perSheet"]) : 1,
  };
}

// The sheet, as shown, for a page of this shape: "auto" turns it to match the page.
export function sheetFor(settings: ResizeSettings, shape: { width: number; height: number }): [number, number] {
  const [short, long] = [...SIZES[settings.size]].sort((a, b) => a - b);
  const landscape = settings.orientation === "auto" ? shape.width > shape.height : settings.orientation === "landscape";
  return landscape ? [long, short] : [short, long];
}

// Columns and rows for several pages to a sheet. Two to a sheet sit side by side on a wide sheet, or one above the
// other on a tall one; the rest fill tall sheets in rows, or wide sheets in columns.
export function gridFor(perSheet: number, landscape: boolean): [number, number] {
  const tall: Record<number, [number, number]> = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 9: [3, 3] };
  const [columns, rows] = tall[perSheet] ?? [1, 1];
  return landscape ? [rows, columns] : [columns, rows];
}

// Scale and offset that fit a box of one size inside another, centred.
function fit(inner: { width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) {
  const scale = Math.min(outer.width / inner.width, outer.height / inner.height);
  return { scale, x: outer.x + (outer.width - inner.width * scale) / 2, y: outer.y + (outer.height - inner.height * scale) / 2 };
}

const asNumbers = (array: PDFArray) => array.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : 0));

// Moves a page's links, fields and comments along with its content.
function moveMarks(page: PDFPage, scale: number, dx: number, dy: number) {
  const doc = page.doc;
  for (const ref of page.node.Annots()?.asArray() ?? []) {
    const annot = doc.context.lookup(ref);
    if (!(annot instanceof PDFDict)) continue;
    for (const key of ["Rect", "QuadPoints", "Vertices", "L", "CL"]) {
      const value = annot.lookupMaybe(PDFName.of(key), PDFArray);
      if (value) annot.set(PDFName.of(key), doc.context.obj(asNumbers(value).map((n, i) => n * scale + (i % 2 ? dy : dx))));
    }
    const ink = annot.lookupMaybe(PDFName.of("InkList"), PDFArray);
    if (ink) {
      annot.set(
        PDFName.of("InkList"),
        doc.context.obj(ink.asArray().map((stroke) => asNumbers(doc.context.lookup(stroke) as PDFArray).map((n, i) => n * scale + (i % 2 ? dy : dx)))),
      );
    }
  }
}

// One page to a sheet: the page keeps everything, and its content is scaled into the new sheet.
function resizeInPlace(page: PDFPage, settings: ResizeSettings) {
  const [shownWidth, shownHeight] = shownSize(page);
  const [sheetWidth, sheetHeight] = sheetFor(settings, { width: shownWidth, height: shownHeight });
  const turned = page.getRotation().angle % 180 !== 0;
  // Worked out in the page's own, unturned coordinates; its turn stays as it was.
  const [width, height] = turned ? [sheetHeight, sheetWidth] : [sheetWidth, sheetHeight];
  const margin = MARGINS[settings.margin];
  const crop = page.getCropBox();
  const place = fit(crop, { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 });
  const dx = place.x - crop.x * place.scale;
  const dy = place.y - crop.y * place.scale;
  const { context } = page.doc;
  page.node.normalize();
  if (!page.node.Contents()) page.node.set(PDFName.of("Contents"), context.obj([]));
  const start = context.register(context.contentStream([pushGraphicsState(), concatTransformationMatrix(place.scale, 0, 0, place.scale, dx, dy)]));
  const end = context.register(context.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
  for (const key of ["CropBox", "BleedBox", "TrimBox", "ArtBox"]) page.node.delete(PDFName.of(key));
  page.node.set(PDFName.of("MediaBox"), context.obj([0, 0, width, height]));
  moveMarks(page, place.scale, dx, dy);
}

export async function resizePdf(bytes: Uint8Array, settings: ResizeSettings): Promise<Uint8Array> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new ResizeError(/is encrypted/i.test(String((error as Error)?.message)) ? "encrypted" : "unreadable");
  }
  if (settings.perSheet === 1) {
    for (const page of source.getPages()) resizeInPlace(page, settings);
    return source.save();
  }
  // Several to a sheet. The sheet's shape follows the first page, unless one was chosen.
  const output = await PDFDocument.create({ updateMetadata: false });
  const pages = source.getPages();
  const [firstWidth, firstHeight] = pages.length ? shownSize(pages[0]) : [1, 1];
  const [columns0, rows0] = gridFor(settings.perSheet, false);
  // On "auto", the sheet turns whichever way lets the pages come out largest.
  const shape =
    settings.orientation === "auto"
      ? (() => {
          const [short, long] = [...SIZES[settings.size]].sort((a, b) => a - b);
          const tall = Math.min(short / columns0 / firstWidth, long / rows0 / firstHeight);
          const [c, r] = gridFor(settings.perSheet, true);
          const wide = Math.min(long / c / firstWidth, short / r / firstHeight);
          return wide > tall ? { width: 2, height: 1 } : { width: 1, height: 2 };
        })()
      : { width: 1, height: 1 };
  const [sheetWidth, sheetHeight] = sheetFor(settings, shape);
  const [columns, rows] = gridFor(settings.perSheet, sheetWidth > sheetHeight);
  const margin = MARGINS[settings.margin];
  const gap = margin;
  const cellWidth = (sheetWidth - margin * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (sheetHeight - margin * 2 - gap * (rows - 1)) / rows;
  for (let first = 0; first < pages.length; first += settings.perSheet) {
    const sheet = output.addPage([sheetWidth, sheetHeight]);
    for (const [index, page] of pages.slice(first, first + settings.perSheet).entries()) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const [width, height] = shownSize(page);
      const cell = { x: margin + column * (cellWidth + gap), y: sheetHeight - margin - (row + 1) * cellHeight - row * gap, width: cellWidth, height: cellHeight };
      const place = fit({ width, height }, cell);
      if (!page.node.Contents()) continue;
      const crop = page.getCropBox();
      const embedded = await output.embedPage(page, { left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height });
      // Drawn the way the page is shown, turned as it is turned.
      const [a, b, c, d, e, f] = shownToPage(page);
      const det = a * d - b * c;
      const back = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det] as const;
      sheet.pushOperators(pushGraphicsState(), concatTransformationMatrix(place.scale, 0, 0, place.scale, place.x, place.y), concatTransformationMatrix(...back));
      sheet.drawPage(embedded, { x: crop.x, y: crop.y, width: crop.width, height: crop.height });
      sheet.pushOperators(popGraphicsState());
    }
  }
  return output.save();
}

// "notes.pdf" becomes "notes_resized.pdf".
export function resizedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_resized.pdf`;
}
