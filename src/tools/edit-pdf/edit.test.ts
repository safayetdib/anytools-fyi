import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { editPdf, editedName, readEdits, type Edit } from "./edit";

const image = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/images/${name}`));

async function blank(width = 300, height = 400, turn = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([width, height]);
  page.setRotation(degrees(turn));
  return doc.save();
}

const text = (overrides: Partial<Extract<Edit, { kind: "text" }>> = {}): Edit => ({
  kind: "text", page: 1, x: 0.1, y: 0.1, text: "Paid in full", font: "helvetica", size: 20, bold: false, italic: false, color: "#000000", baseline: 0.9, ...overrides,
});

// Each piece of text, with where its baseline starts on the page as shown, measured from the top-left corner.
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

// The colour of one pixel of the first page as shown, drawn at 1 pixel per point.
async function pixel(bytes: Uint8Array, x: number, y: number) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const page = await doc.getPage(1);
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
}

describe("editPdf", () => {
  it("writes text where it was placed, each line below the last", async () => {
    const result = await editPdf(await blank(), [text({ text: "Paid in full\nThank you" })], []);
    // The box's top is 40 points down; the first baseline 18 points below that, the next 24 points further.
    expect(await textOf(result)).toEqual([
      { text: "Paid in full", x: 30, y: 58 },
      { text: "Thank you", x: 30, y: 82 },
    ]);
  });

  it("follows a turned page, so text reads the right way up where it was put", async () => {
    // 400 wide and 300 tall as shown.
    const result = await editPdf(await blank(300, 400, 90), [text({ x: 0.25, y: 0.5 })], []);
    expect(await textOf(result)).toEqual([{ text: "Paid in full", x: 100, y: 168 }]);
    const turned = await editPdf(await blank(300, 400, 270), [text({ x: 0.25, y: 0.5 })], []);
    expect(await textOf(turned)).toEqual([{ text: "Paid in full", x: 100, y: 168 }]);
  });

  it("measures from a cropped page's visible corner", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).setCropBox(50, 100, 200, 200);
    const result = await editPdf(await doc.save(), [text({ x: 0.5, y: 0.5 })], []);
    expect(await textOf(result)).toEqual([{ text: "Paid in full", x: 100, y: 118 }]);
  });

  it("places a picture once in the file, however often it's used", async () => {
    const edits: Edit[] = [1, 2].map((page) => ({ kind: "image", page, x: 0.1, y: 0.1, width: 0.5, height: 0.2, image: 0 }));
    const source = await PDFDocument.create();
    source.addPage([300, 400]);
    source.addPage([300, 400]);
    const result = await editPdf(await source.save(), edits, [{ bytes: image("wide.jpg"), kind: "jpg" }]);
    const doc = await PDFDocument.load(result);
    const refs = doc.getPages().map((page) => {
      const xobjects = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
      return xobjects ? xobjects.keys().map((key) => String(xobjects.get(key))) : [];
    });
    expect(refs.flat()).toHaveLength(2);
    expect(new Set(refs.flat()).size).toBe(1);
    // The photo goes in as it is.
    expect(Buffer.from(result).includes(image("wide.jpg"))).toBe(true);
  });

  it("draws shapes, lines, ink, highlights and whiteout without error, on top in the order added", async () => {
    const edits: Edit[] = [
      { kind: "rect", page: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.2, color: "#cc0000", fill: false, thickness: 2 },
      { kind: "ellipse", page: 1, x: 0.5, y: 0.1, width: 0.3, height: 0.2, color: "#0000cc", fill: true, thickness: 2 },
      { kind: "highlight", page: 1, x: 0.1, y: 0.5, width: 0.5, height: 0.05, color: "#000000", fill: true, thickness: 1 },
      { kind: "whiteout", page: 1, x: 0.1, y: 0.7, width: 0.5, height: 0.1, color: "#000000", fill: true, thickness: 1 },
      { kind: "line", page: 1, x1: 0.1, y1: 0.9, x2: 0.9, y2: 0.9, color: "#00aa00", thickness: 3 },
      { kind: "draw", page: 1, points: [[0.2, 0.3], [0.3, 0.35], [0.4, 0.3]], color: "#000000", thickness: 2 },
    ];
    const result = await editPdf(await blank(), edits, []);
    // The rectangle's left edge, the filled ellipse's middle, the highlight, the line, and blank paper.
    expect(await pixel(result, 30, 50)).toEqual([204, 0, 0]);
    expect(await pixel(result, 195, 80)).toEqual([0, 0, 204]);
    expect(await pixel(result, 100, 210)).toEqual([255, 225, 77]);
    expect(await pixel(result, 150, 360)).toEqual([0, 170, 0]);
    expect(await pixel(result, 250, 250)).toEqual([255, 255, 255]);
  });

  it("refuses nothing to do, a locked file and one that isn't a PDF", async () => {
    await expect(editPdf(await blank(), [], [])).rejects.toMatchObject({ code: "empty" });
    await expect(editPdf(await makeEncryptedPdf(), [text()], [])).rejects.toMatchObject({ code: "encrypted" });
    await expect(editPdf(new Uint8Array([1, 2, 3]), [text()], [])).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("readEdits", () => {
  it("keeps whole edits and drops broken ones", () => {
    const edits = readEdits(
      JSON.stringify([
        { kind: "text", page: 1, x: 0.1, y: 0.2, text: "Hi\r\nthere", font: "comic", size: 999, color: "red", baseline: 0.9 },
        { kind: "text", page: 1, x: 0.1, y: 0.2, text: "   " },
        { kind: "rect", page: 2, x: -1, y: 2, width: 0.5, height: 0.5, color: "#ABCDEF", fill: true, thickness: 99 },
        { kind: "draw", page: 1, points: [[0.1, 0.1], ["x", 1], [0.2, 0.2]] },
        { kind: "image", page: 1, x: 0, y: 0, width: 1, height: 1, image: -1 },
        { kind: "laser", page: 1 },
        { kind: "line", page: 0, x1: 0, y1: 0, x2: 1, y2: 1 },
      ]),
    );
    expect(edits).toEqual([
      { kind: "text", page: 1, x: 0.1, y: 0.2, text: "Hi\nthere", font: "helvetica", size: 200, bold: false, italic: false, color: "#000000", baseline: 0.9 },
      { kind: "rect", page: 2, x: 0, y: 1, width: 0.5, height: 0.5, color: "#abcdef", fill: true, thickness: 20 },
      { kind: "draw", page: 1, points: [[0.1, 0.1], [0.2, 0.2]], color: "#000000", thickness: 2 },
    ]);
    expect(readEdits("not json")).toEqual([]);
  });
});

describe("editedName", () => {
  it("names the result like other tools", () => {
    expect(editedName("form.PDF")).toBe("form_edited.pdf");
  });
});
