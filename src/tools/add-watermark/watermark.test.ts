import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../tests/fixtures/pdf";
import { DEFAULT_SETTINGS, centreFor, mosaicCentres, readSettings, turnedSize, watermarkPdf, watermarkedName, type Settings } from "./watermark";

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });
const round = (point: { x: number; y: number }) => ({ x: Math.round(point.x), y: Math.round(point.y) });

// The text on each page with where it starts, read back the way a PDF reader sees it.
async function texts(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[];
    pages.push(
      items
        .filter((item) => item.str.trim())
        .map((item) => {
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          return { text: item.str, x: Math.round(x), y: Math.round(viewport.height - y) };
        }),
    );
  }
  await task.destroy();
  return pages;
}

// Each content stream of a page, decoded, in drawing order.
async function streams(bytes: Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  return refs.map((ref) => {
    const stream = doc.context.lookup(ref as never) as PDFRawStream;
    return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  });
}

async function strengths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const states = doc.getPage(0).node.Resources()?.lookup(PDFName.of("ExtGState"), PDFDict);
  return (states?.values() ?? []).map((state) => (doc.context.lookup(state) as PDFDict).lookup(PDFName.of("ca"), PDFNumber)?.asNumber());
}

describe("readSettings", () => {
  it("starts like other tools, with our own placeholder text", () => {
    expect(readSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ kind: "text", text: "CONFIDENTIAL", vertical: "top", horizontal: "left", mosaic: false, transparency: 0, rotation: 0, layer: "over", size: 14 });
  });

  it("keeps known choices and fixes the rest", () => {
    expect(readSettings(JSON.stringify({ transparency: 75, rotation: 45, layer: "below", size: 999 }))).toMatchObject({ transparency: 75, rotation: 45, layer: "below", size: 200 });
    expect(readSettings(JSON.stringify({ transparency: 30, rotation: 10 }))).toMatchObject({ transparency: 0, rotation: 0 });
  });
});

describe("placement", () => {
  it("measures a turned box", () => {
    const upright = turnedSize(100, 20, 90);
    expect([Math.round(upright.width), Math.round(upright.height)]).toEqual([20, 100]);
    const diagonal = turnedSize(100, 20, 45);
    expect(Math.round(diagonal.width)).toBe(85);
  });

  it("centres the watermark in each spot, keeping its turned box inside the margins", () => {
    expect(round(centreFor(600, 800, 100, 20, settings({ vertical: "top", horizontal: "left" })))).toEqual({ x: 68, y: 772 });
    expect(round(centreFor(600, 800, 100, 20, settings({ vertical: "middle", horizontal: "center" })))).toEqual({ x: 300, y: 400 });
    expect(round(centreFor(600, 800, 100, 20, settings({ vertical: "bottom", horizontal: "right", rotation: 90 })))).toEqual({ x: 572, y: 68 });
  });

  it("repeats the watermark in rows and columns for Mosaic", () => {
    const centres = mosaicCentres(600, 800, 100, 20);
    expect(centres.length).toBeGreaterThan(10);
    expect(centres.every(({ x, y }) => x > 0 && x < 600 && y > 0 && y < 800)).toBe(true);
  });
});

describe("watermarkPdf", () => {
  it("stamps the text at the top left of every page by default", async () => {
    const pages = await texts(await watermarkPdf(await makePdf([300, 300], 400), settings()));
    expect(pages.map((page) => page.map((item) => item.text))).toEqual([["CONFIDENTIAL"], ["CONFIDENTIAL"]]);
    expect(pages[0][0].x).toBe(18);
    expect(pages[0][0].y).toBeGreaterThan(360);
  });

  it("stamps only the chosen pages", async () => {
    const pages = await texts(await watermarkPdf(await makePdf([300, 300, 300], 400), settings({ from: 2, to: 2 })));
    expect(pages.map((page) => page.length)).toEqual([0, 1, 0]);
  });

  it("repeats it across the page for Mosaic", async () => {
    const [page] = await texts(await watermarkPdf(await makePdf([600], 800), settings({ mosaic: true, size: 20 })));
    expect(page.length).toBeGreaterThan(6);
  });

  it("draws it see-through at the chosen transparency", async () => {
    expect(await strengths(await watermarkPdf(await makePdf([300], 400), settings({ transparency: 75 })))).toContain(0.25);
  });

  it("puts it below the page's content, or over it", async () => {
    const below = await streams(await watermarkPdf(await makePdf([300], 400), settings({ layer: "below" })));
    expect(below[0]).toContain("Tj");
    const over = await streams(await watermarkPdf(await makePdf([300], 400), settings()));
    expect(over.at(-1)).toContain("Tj");
    expect(over[0]).not.toContain("Tj");
  });

  it("keeps it upright on turned pages", async () => {
    const source = await PDFDocument.load(await makePdf([300, 300], 400));
    source.getPage(1).setRotation(degrees(90));
    const pages = await texts(await watermarkPdf(await source.save(), settings({ vertical: "bottom", horizontal: "left" })));
    expect(pages[1][0]).toMatchObject({ text: "CONFIDENTIAL", x: 18 });
    expect(pages[1][0].y).toBeLessThan(25);
  });

  it("places an image, keeping see-through parts", async () => {
    const logo = new Uint8Array(readFileSync("tests/fixtures/images/logo.png"));
    const bytes = await watermarkPdf(await makePdf([600], 800), settings({ kind: "image" }), { bytes: logo, kind: "png" });
    const doc = await PDFDocument.load(bytes);
    const images = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    expect(images?.keys().length).toBe(1);
    expect((await texts(bytes))[0]).toEqual([]);
  });

  it("refuses text the built-in fonts can't draw", async () => {
    await expect(watermarkPdf(await makePdf([300], 400), settings({ text: "গোপনীয়" }))).rejects.toMatchObject({ code: "text" });
  });
});

describe("watermarkedName", () => {
  it("names files like other PDF tools do", () => {
    expect(watermarkedName("report.pdf")).toBe("report_watermark.pdf");
    expect(watermarkedName(".pdf")).toBe("document_watermark.pdf");
  });
});
