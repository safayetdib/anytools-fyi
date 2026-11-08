import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildPdf, isHeic, jpegOrientation, pageLayout, pdfName, readSettings, type Settings } from "./layout";

const image = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`));
const settings = (overrides: Partial<Settings> = {}): Settings => ({ size: "a4", orientation: "portrait", margin: "none", merge: true, ...overrides });
const round = (values: number[]) => values.map((value) => Math.round(value * 100) / 100);

describe("jpegOrientation", () => {
  it("reads the turn a phone stored in the photo", () => {
    expect(jpegOrientation(image("phone.jpg"))).toBe(6);
    expect(jpegOrientation(image("tall.jpg"))).toBe(1);
    expect(jpegOrientation(new Uint8Array([1, 2, 3]))).toBe(1);
  });
});

describe("isHeic", () => {
  it("spots iPhone HEIC photos by their contents, not their name", () => {
    expect(isHeic(image("iphone.heic"))).toBe(true);
    expect(isHeic(image("tall.jpg"))).toBe(false);
    expect(isHeic(image("logo.png"))).toBe(false);
    expect(isHeic(new Uint8Array(4))).toBe(false);
  });
});

describe("pageLayout", () => {
  it("Fit makes the page the image's size at 96 dpi, plus margins", () => {
    expect(pageLayout(600, 800, 0, settings({ size: "fit" }))).toEqual({ page: [450, 600], box: { x: 0, y: 0, width: 450, height: 600 } });
    expect(pageLayout(600, 800, 0, settings({ size: "fit", margin: "small" })).page).toEqual([490, 640]);
    expect(pageLayout(600, 800, 0, settings({ size: "fit", margin: "big" })).page).toEqual([550, 700]);
  });

  it("A4 and Letter fit the image inside the margins, centred", () => {
    const a4 = pageLayout(900, 500, 0, settings());
    expect(round(a4.page)).toEqual([595.28, 841.89]);
    expect(round([a4.box.x, a4.box.y, a4.box.width, a4.box.height])).toEqual([0, 255.59, 595.28, 330.71]);
    const letter = pageLayout(500, 900, 0, settings({ size: "letter", orientation: "landscape", margin: "small" }));
    expect(letter.page).toEqual([792, 612]);
    expect(round([letter.box.width, letter.box.height])).toEqual([317.78, 572]);
  });

  it("turned images swap their width and height", () => {
    expect(pageLayout(900, 500, 90, settings({ size: "fit" })).page).toEqual([375, 675]);
    expect(pageLayout(900, 500, 180, settings({ size: "fit" })).page).toEqual([675, 375]);
  });
});

describe("buildPdf", () => {
  it("places JPG and PNG images, one per page, in order", async () => {
    const bytes = await buildPdf(
      [
        { bytes: image("tall.jpg"), kind: "jpg", rotate: 0 },
        { bytes: image("logo.png"), kind: "png", rotate: 0 },
        { bytes: image("wide.jpg"), kind: "jpg", rotate: 90 },
      ],
      settings({ size: "fit" }),
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([
      [450, 600],
      [300, 300],
      [375, 675],
    ]);
  });
});

describe("pdfName", () => {
  it.each([
    ["tall.jpg", "tall.pdf"],
    ["Photo.JPEG", "Photo.pdf"],
    ["scan.heic", "scan.pdf"],
    ["ছবি.png", "ছবি.pdf"],
    [".png", "image.pdf"],
  ])("names %j like other PDF tools do", (original, name) => {
    expect(pdfName(original)).toBe(name);
  });
});

describe("readSettings", () => {
  it("keeps known choices and falls back to the defaults", () => {
    expect(readSettings('{"size":"fit","orientation":"landscape","margin":"big","merge":false}')).toEqual({
      size: "fit",
      orientation: "landscape",
      margin: "big",
      merge: false,
    });
    expect(readSettings('{"size":"huge","margin":7}')).toEqual(settings());
    expect(readSettings("nope")).toEqual(settings());
  });
});
