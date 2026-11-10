import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { pagesToRedact, readBoxes, redactPdf, redactedName, type RedactedPage } from "./redact";

const photo = new Uint8Array(readFileSync("tests/fixtures/images/wide.jpg"));

// A letter whose first page holds an account number and whose second page is harmless.
async function letter() {
  const doc = await PDFDocument.create();
  doc.setTitle("Account statement for Rahim Uddin");
  const font = await doc.embedFont(StandardFonts.Courier);
  doc.addPage([300, 400]).drawText("Account 4821-7730-1199", { x: 20, y: 360, size: 12, font });
  const second = doc.addPage([400, 300]);
  second.drawText("Thank you for banking with us", { x: 20, y: 260, size: 12, font });
  second.setRotation(degrees(90));
  return doc.save();
}

async function texts(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const { items } = await (await doc.getPage(number)).getTextContent();
    pages.push(items.map((item) => ("str" in item ? item.str : "")).join(""));
  }
  return pages;
}

const picture = (page: number): RedactedPage => ({ page, bytes: photo, kind: "jpg", width: 300, height: 400 });

describe("redactPdf", () => {
  it("replaces a marked page with its picture, so its words are gone from the file", async () => {
    const result = await redactPdf(await letter(), [picture(1)]);
    expect(await texts(result)).toEqual(["", "Thank you for banking with us"]);
    const doc = await PDFDocument.load(result);
    expect(doc.getPages().map((page) => [page.getWidth(), page.getHeight(), page.getRotation().angle])).toEqual([
      [300, 400, 0],
      [400, 300, 90],
    ]);
    // The title named the account holder; it isn't carried over.
    expect(doc.getTitle()).toBeUndefined();
  });

  it("leaves nothing of a marked page inside the file, not even its font", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Courier);
    doc.addPage([300, 400]).drawText("Account 4821-7730-1199", { x: 20, y: 360, size: 12, font });
    const result = await redactPdf(await doc.save({ useObjectStreams: false }), [picture(1)]);
    expect(Buffer.from(result).includes("Courier")).toBe(false);
    expect(await texts(result)).toEqual([""]);
  });

  it("refuses nothing to do, a locked file and one that isn't a PDF", async () => {
    await expect(redactPdf(await letter(), [])).rejects.toMatchObject({ code: "empty" });
    await expect(redactPdf(await makeEncryptedPdf(), [picture(1)])).rejects.toMatchObject({ code: "encrypted" });
    await expect(redactPdf(new Uint8Array([1, 2, 3]), [picture(1)])).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("readBoxes", () => {
  it("keeps boxes on the page and drops broken or tiny ones", () => {
    const boxes = readBoxes(
      JSON.stringify([
        { page: 2, x: 0.9, y: -1, width: 0.5, height: 0.2 },
        { page: 1, x: 0.1, y: 0.1, width: 0.0001, height: 0.2 },
        { page: 0, x: 0, y: 0, width: 1, height: 1 },
        { page: 1, x: "a", y: 0, width: 1, height: 1 },
        { page: 3, x: 0, y: 0, width: 1, height: 1 },
      ]),
    );
    expect(boxes).toEqual([
      { page: 2, x: 0.9, y: 0, width: expect.closeTo(0.1), height: 0.2 },
      { page: 3, x: 0, y: 0, width: 1, height: 1 },
    ]);
    expect(pagesToRedact([...boxes, { page: 2, x: 0, y: 0, width: 1, height: 1 }])).toEqual([2, 3]);
    expect(readBoxes("oops")).toEqual([]);
  });

  it("names the result like other tools", () => {
    expect(redactedName("contract.pdf")).toBe("contract_redacted.pdf");
  });
});
