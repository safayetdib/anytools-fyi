import { PDFDocument, degrees, type PDFPage } from "pdf-lib";
import type { CropRect } from "../shell/crop";
import type { PagePlan, PageSize } from "../shell/types";

// Sheet sizes in PDF points (1/72 inch).
const SHEETS = { a4: [595.28, 841.89], letter: [612, 792] } as const;
// Room around each page on a standard sheet, about 1 cm, so nothing sits on the printer's edge.
const MARGIN = 28;

function sheetFor(pageSize: Exclude<PageSize, "original">, wide: boolean): [number, number] {
  const [name, orientation] = pageSize.split("-") as ["a4" | "letter", "portrait" | "landscape" | "auto"];
  const [short, long] = SHEETS[name];
  const landscape = orientation === "landscape" || (orientation === "auto" && wide);
  return landscape ? [long, short] : [short, long];
}

// The area to keep, in PDF points from the bottom-left corner, inside the page's current crop box.
function cropArea(page: PDFPage, crop?: CropRect) {
  const box = page.getCropBox();
  if (!crop) return box;
  return {
    x: box.x + crop.x * box.width,
    y: box.y + (1 - crop.y - crop.height) * box.height,
    width: crop.width * box.width,
    height: crop.height * box.height,
  };
}

// Draws a source page, turned clockwise by `turn`, centred and scaled to fit inside the sheet's margins.
async function placeOnSheet(
  result: PDFDocument,
  source: PDFPage,
  turn: number,
  pageSize: Exclude<PageSize, "original">,
  crop?: CropRect,
) {
  const sideways = turn === 90 || turn === 270;
  const area = cropArea(source, crop);
  const { width: sourceWidth, height: sourceHeight } = area;
  // A page with nothing drawn on it can't be embedded, so it becomes an empty sheet of the right shape.
  if (!source.node.Contents()) {
    const wide = sideways ? sourceHeight > sourceWidth : sourceWidth > sourceHeight;
    result.addPage(sheetFor(pageSize, wide));
    return;
  }
  const embedded = await result.embedPage(source, {
    left: area.x,
    bottom: area.y,
    right: area.x + area.width,
    top: area.y + area.height,
  });
  const shownWidth = sideways ? embedded.height : embedded.width;
  const shownHeight = sideways ? embedded.width : embedded.height;
  const [sheetWidth, sheetHeight] = sheetFor(pageSize, shownWidth > shownHeight);
  const scale = Math.min((sheetWidth - MARGIN * 2) / shownWidth, (sheetHeight - MARGIN * 2) / shownHeight);
  const width = embedded.width * scale;
  const height = embedded.height * scale;
  const left = (sheetWidth - shownWidth * scale) / 2;
  const bottom = (sheetHeight - shownHeight * scale) / 2;
  // pdf-lib turns drawings anticlockwise around their bottom-left corner, so shift each turn back into place.
  const origin: Record<number, [number, number]> = {
    0: [left, bottom],
    90: [left, bottom + width],
    180: [left + width, bottom + height],
    270: [left + height, bottom],
  };
  const [x, y] = origin[turn];
  const sheet = result.addPage([sheetWidth, sheetHeight]);
  sheet.drawPage(embedded, { x, y, width, height, rotate: degrees(-turn) });
}

// Builds a new PDF from a page plan. Pages are counted from 1, and any page left out is removed.
export async function rearrangePdf(bytes: Uint8Array, plan: PagePlan): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const count = source.getPageCount();
  const { pages, pageSize } = plan;
  if (pages.length === 0 || pages.some(({ page }) => !Number.isInteger(page) || page < 1 || page > count)) {
    throw new Error("Page plan doesn't match the document");
  }
  const result = await PDFDocument.create();
  if (pageSize === "original") {
    const copies = await result.copyPages(
      source,
      pages.map(({ page }) => page - 1),
    );
    copies.forEach((copy, index) => {
      const { rotate, crop } = pages[index];
      copy.setRotation(degrees((copy.getRotation().angle + rotate) % 360));
      if (crop) {
        const area = cropArea(copy, crop);
        copy.setCropBox(area.x, area.y, area.width, area.height);
      }
      result.addPage(copy);
    });
  } else {
    for (const { page, rotate, crop } of pages) {
      const original = source.getPage(page - 1);
      const turn = (((original.getRotation().angle + rotate) % 360) + 360) % 360;
      await placeOnSheet(result, original, turn, pageSize, crop);
    }
  }
  return { bytes: await result.save(), pageCount: result.getPageCount() };
}
