import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFString, PageSizes, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { DEFAULT_SETTINGS, ResizeError, gridFor, readSettings, resizePdf, resizedName, sheetFor } from "./resize";

// A Letter page with a link, a small wide page and a turned A5 page, each with a word near its top-left corner.
async function mixed(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, size] of [PageSizes.Letter, [400, 200] as [number, number], PageSizes.A5].entries()) {
    const page = doc.addPage(size);
    page.drawText(`Page ${index + 1}`, { x: 20, y: size[1] - 40, size: 12, font });
    if (index === 2) page.setRotation(degrees(90));
  }
  const page = doc.getPage(0);
  const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [20, 20, 120, 40], A: { S: "URI", URI: PDFString.of("https://anytools.fyi") } }));
  page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  return doc.save();
}

async function read(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
    const links = (await page.getAnnotations()).map((annotation) => annotation.rect.map((n: number) => Math.round(n)));
    pages.push({ width: Math.round(viewport.width), height: Math.round(viewport.height), text, links });
  }
  return pages;
}

describe("resizePdf", () => {
  it("fits each page on an A4 sheet turned to match it, keeping its text and links", async () => {
    const pages = await read(await resizePdf(await mixed(), DEFAULT_SETTINGS));
    expect(pages.map((page) => [page.width, page.height, page.text])).toEqual([
      [595, 842, "Page 1"],
      [842, 595, "Page 2"],
      [842, 595, "Page 3"],
    ]);
    // Letter is a little wider than A4, so it's scaled down a touch and the link moves with it.
    const scale = 595.28 / 612;
    expect(pages[0].links).toEqual([[Math.round(20 * scale), Math.round(20 * scale + (841.89 - 792 * scale) / 2), Math.round(120 * scale), Math.round(40 * scale + (841.89 - 792 * scale) / 2)]]);
  });

  it("can put several pages on each sheet, with margins", async () => {
    const pages = await read(await resizePdf(await mixed(), { size: "a4", orientation: "portrait", margin: "small", perSheet: 2 }));
    expect(pages.map((page) => [page.width, page.height])).toEqual([
      [595, 842],
      [595, 842],
    ]);
    expect(pages[0].text).toBe("Page 1 Page 2");
    expect(pages[1].text).toBe("Page 3");
  });

  it("reads settings safely and works out grids and sheets", async () => {
    expect(readSettings({ size: "legal", orientation: "landscape", margin: "big", perSheet: "4" })).toEqual({ size: "legal", orientation: "landscape", margin: "big", perSheet: 4 });
    expect(readSettings({ size: "huge", perSheet: "5" })).toEqual(DEFAULT_SETTINGS);
    expect(gridFor(2, true)).toEqual([2, 1]);
    expect(gridFor(6, false)).toEqual([2, 3]);
    expect(sheetFor({ ...DEFAULT_SETTINGS, size: "letter" }, { width: 3, height: 2 })).toEqual([792, 612]);
    await expect(resizePdf(await makeEncryptedPdf(), DEFAULT_SETTINGS)).rejects.toBeInstanceOf(ResizeError);
    expect(resizedName("notes.PDF")).toBe("notes_resized.pdf");
  });
});
