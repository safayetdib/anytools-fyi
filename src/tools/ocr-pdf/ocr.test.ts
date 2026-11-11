import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makeSharedImagePdf } from "../../../tests/fixtures/pdf";
import { addTextLayers, hasText, ocrName, readLanguages } from "./ocr";

// A text layer like the reader makes: one page at the shape shown, with words on it. (The reader's are invisible.)
async function layer(width: number, height: number, words: { text: string; x: number; y: number }[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([width, height]);
  for (const word of words) page.drawText(word.text, { ...word, size: 20, font });
  return doc.save();
}

// Each piece of text on the page, with where it starts as the page is shown, measured from the top-left corner.
async function textOf(bytes: Uint8Array, number = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  return items
    .filter((item) => "str" in item && item.str.trim())
    .map((item) => {
      const { str, transform } = item as { str: string; transform: number[] };
      const [x, y] = viewport.convertToViewportPoint(transform[4], transform[5]);
      return { text: str, x: Math.round(x), y: Math.round(y) };
    });
}

describe("addTextLayers", () => {
  it("lays the text over the page where it was read, scaled to the page", async () => {
    const original = await PDFDocument.create();
    original.addPage([300, 400]);
    const bytes = await original.save();
    // Read at twice the page's size, as a picture of it would be.
    const result = await addTextLayers(bytes, [{ page: 1, layer: await layer(600, 800, [{ text: "Invoice", x: 40, y: 720 }]) }]);
    expect(await textOf(result)).toEqual([{ text: "Invoice", x: 20, y: 40 }]);
  });

  it("follows a turned page and its crop, so the text sits on what's shown", async () => {
    const original = await PDFDocument.create();
    const page = original.addPage([300, 400]);
    page.setRotation(degrees(90));
    page.setCropBox(10, 20, 280, 360);
    const bytes = await original.save();
    // Shown sideways and cropped: 360 wide and 280 tall.
    const result = await addTextLayers(bytes, [{ page: 1, layer: await layer(360, 280, [{ text: "Total", x: 30, y: 240 }]) }]);
    expect(await textOf(result)).toEqual([{ text: "Total", x: 30, y: 40 }]);
  });

  it("leaves pages without a layer as they were, and the file barely bigger", async () => {
    const bytes = await makeSharedImagePdf(3);
    const result = await addTextLayers(bytes, [{ page: 2, layer: await layer(300, 400, [{ text: "Hello", x: 10, y: 300 }]) }]);
    expect(await textOf(result, 1)).toEqual([]);
    expect((await textOf(result, 2)).map((item) => item.text)).toEqual(["Hello"]);
    expect(result.length).toBeLessThan(bytes.length + 8 * 1024);
  });

  it("says when a file needs its password, or isn't a PDF", async () => {
    await expect(addTextLayers(await makeEncryptedPdf(), [])).rejects.toMatchObject({ code: "encrypted" });
    await expect(addTextLayers(new Uint8Array([1, 2, 3]), [])).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("hasText", () => {
  it("tells a page with text from a scan with only a page number on it", () => {
    expect(hasText("Dear customer, your order has shipped.")).toBe(true);
    expect(hasText("আমার সোনার বাংলা, আমি তোমায় ভালোবাসি")).toBe(true);
    expect(hasText("  12  ")).toBe(false);
    expect(hasText("")).toBe(false);
  });
});

describe("readLanguages", () => {
  it("reads the chosen languages, and falls back to English", () => {
    expect(readLanguages("eng+ben")).toEqual(["eng", "ben"]);
    expect(readLanguages("ben")).toEqual(["ben"]);
    expect(readLanguages("klingon")).toEqual(["eng"]);
    expect(readLanguages("")).toEqual(["eng"]);
  });
});

describe("ocrName", () => {
  it("names the result like other tools", () => {
    expect(ocrName("scan.PDF")).toBe("scan_ocr.pdf");
    expect(ocrName(".pdf")).toBe("document_ocr.pdf");
  });
});
