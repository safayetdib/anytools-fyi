import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, cmyk, rgb } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { grayContent, grayName, grayscalePdf, tokenize } from "./gray";

const image = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`));
// Stands in for the browser's JPEG encoder: any grey JPEG will do for checking where it goes.
const fakeJpeg = async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
}

describe("tokenize", () => {
  it("keeps strings, arrays, dictionaries and inline pictures whole", () => {
    const tokens = tokenize("BT (1 0 0 rg \\) inside) Tj [(a) -20 (b(c))] TJ ET /P <</MCID 3>> BDC BI /W 1 /H 1 ID \x00rg\xff EI Q");
    expect(tokens.map((token) => token.text)).toEqual([
      "BT", "(1 0 0 rg \\) inside)", "Tj", "[(a) -20 (b(c))]", "TJ", "ET", "/P", "<</MCID 3>>", "BDC", "BI /W 1 /H 1 ID \x00rg\xff EI", "Q",
    ]);
    // A hex string at the end of a dictionary, as tagged PDFs write them.
    expect(tokenize("/Span<</ActualText<FEFF2002>>> BDC ( )Tj").map((token) => token.text)).toEqual(["/Span", "<</ActualText<FEFF2002>>>", "BDC", "( )", "Tj"]);
  });
});

describe("grayContent", () => {
  it("turns RGB and CMYK colours into their grey", async () => {
    const { context } = await PDFDocument.create();
    expect(grayContent("1 0 0 rg 0 0 1 RG 0 0 0 1 k 0.5 g (red) Tj", context, undefined)).toBe("0.299 g 0.114 G 0 g 0.5 g (red) Tj");
    expect(grayContent("/DeviceRGB cs 0 1 0 sc /Pattern cs /P0 scn", context, undefined)).toBe("/DeviceGray cs 0.587 sc /Pattern cs /P0 scn");
  });
});

describe("grayscalePdf", () => {
  it("makes coloured shapes and text grey, keeping the text as text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 400]);
    page.drawRectangle({ x: 0, y: 300, width: 100, height: 100, color: rgb(1, 0, 0) });
    page.drawRectangle({ x: 100, y: 300, width: 100, height: 100, color: cmyk(1, 0, 0, 0) });
    page.drawText("Invoice", { x: 20, y: 200, size: 20, font, color: rgb(0, 0.5, 1) });
    const result = await grayscalePdf(await doc.save(), fakeJpeg);
    const [r, g, b] = (await pixel(result, 50, 50)) as number[];
    expect(r).toBe(g);
    expect(g).toBe(b);
    // Red is a dark grey, as it looks to the eye.
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(90);
    const cyan = (await pixel(result, 150, 50)) as number[];
    expect(new Set(cyan).size).toBe(1);
    const text = await (await (await pdfjs.getDocument({ data: result.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise).getPage(1)).getTextContent();
    expect(text.items.map((item) => ("str" in item ? item.str : "")).join("")).toBe("Invoice");
  });

  it("makes pictures grey: PNGs as one grey channel, JPEGs through the encoder", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.drawImage(await doc.embedPng(image("logo.png")), { x: 0, y: 0, width: 100, height: 100 });
    page.drawImage(await doc.embedJpg(image("wide.jpg")), { x: 100, y: 0, width: 180, height: 100 });
    const before = await doc.save();
    const result = await grayscalePdf(before, fakeJpeg);
    const out = await PDFDocument.load(result);
    const pictures = out.context
      .enumerateIndirectObjects()
      .map(([, object]) => object)
      .filter((object): object is PDFRawStream => object instanceof PDFRawStream && object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Image"));
    const spaces = pictures.map((picture) => String(picture.dict.lookup(PDFName.of("ColorSpace"))));
    // The PNG's colours and its see-through mask are grey; the JPEG came back from the encoder.
    expect(spaces.filter((space) => space === "/DeviceGray").length).toBeGreaterThanOrEqual(2);
    expect(pictures.some((picture) => picture.getContentsSize() === 4)).toBe(true);
    expect(result.length).toBeLessThan(before.length);
  });

  it("leaves a picture alone when the encoder can't read it", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).drawImage(await doc.embedJpg(image("wide.jpg")), { x: 0, y: 0, width: 100, height: 100 });
    const result = await grayscalePdf(await doc.save(), async () => null);
    expect(Buffer.from(result).includes(image("wide.jpg"))).toBe(true);
  });

  it("refuses a locked file and one that isn't a PDF", async () => {
    await expect(grayscalePdf(await makeEncryptedPdf(), fakeJpeg)).rejects.toMatchObject({ code: "encrypted" });
    await expect(grayscalePdf(new Uint8Array([1, 2]), fakeJpeg)).rejects.toMatchObject({ code: "unreadable" });
    expect(grayName("flyer.pdf")).toBe("flyer_grayscale.pdf");
  });
});
