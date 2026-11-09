import { readFileSync } from "node:fs";
import { PDFDict, PDFDocument, PDFName, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf } from "../../../tests/fixtures/pdf";
import { placedRect, readPlacements, signPdf, signedName } from "./sign";

// Any real PNG will do; the width and height give the proportions to draw it at.
const image = { bytes: new Uint8Array(readFileSync("tests/fixtures/images/logo.png")), width: 400, height: 100 };

const imagesOn = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0);
};

describe("readPlacements", () => {
  it("keeps placements inside the page and drops broken ones", () => {
    expect(
      readPlacements(
        JSON.stringify([
          { page: 1, x: 0.1, y: 0.8, width: 0.3 },
          { page: 2, x: -1, y: 2, width: 5 },
          { page: 0, x: 0.1, y: 0.1, width: 0.2 },
          { page: "x" },
          "nonsense",
        ]),
      ),
    ).toEqual([
      { page: 1, x: 0.1, y: 0.8, width: 0.3 },
      { page: 2, x: 0, y: 1, width: 1 },
    ]);
    expect(readPlacements("not json")).toEqual([]);
  });
});

describe("placedRect", () => {
  it("measures from the top-left as shown, with the picture's own proportions", () => {
    // A 400 × 100 signature, a quarter of a 600 × 800 page wide, its top 70% of the way down.
    expect(placedRect(600, 800, { page: 1, x: 0.5, y: 0.7, width: 0.25 }, 4)).toEqual({ x: 300, y: 800 - 560 - 37.5, width: 150, height: 37.5 });
  });
});

describe("signPdf", () => {
  it("draws the signature on each chosen page, once per placement", async () => {
    const bytes = await signPdf(await makePdf([300, 300, 300], 400), image, [
      { page: 1, x: 0.1, y: 0.8, width: 0.3 },
      { page: 3, x: 0.1, y: 0.1, width: 0.3 },
      { page: 3, x: 0.6, y: 0.8, width: 0.3 },
    ]);
    expect(await imagesOn(bytes)).toEqual([1, 0, 2]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it("works on pages the PDF itself turns", async () => {
    const source = await PDFDocument.load(await makePdf([300, 300], 400));
    source.getPage(1).setRotation(degrees(90));
    const bytes = await signPdf(await source.save(), image, [{ page: 2, x: 0.5, y: 0.5, width: 0.4 }]);
    expect(await imagesOn(bytes)).toEqual([0, 1]);
  });

  it("ignores placements on pages the PDF doesn't have", async () => {
    const bytes = await signPdf(await makePdf([300]), image, [
      { page: 1, x: 0.1, y: 0.1, width: 0.2 },
      { page: 5, x: 0.1, y: 0.1, width: 0.2 },
    ]);
    expect(await imagesOn(bytes)).toEqual([1]);
  });

  it("needs at least one placement", async () => {
    await expect(signPdf(await makePdf([300]), image, [])).rejects.toMatchObject({ code: "empty" });
  });

  it("explains password-protected and damaged files", async () => {
    const place = [{ page: 1, x: 0.1, y: 0.1, width: 0.2 }];
    await expect(signPdf(await makeEncryptedPdf(), image, place)).rejects.toMatchObject({ code: "encrypted" });
    await expect(signPdf(new TextEncoder().encode("not a pdf"), image, place)).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("signedName", () => {
  it.each([
    ["agreement.pdf", "agreement_signed.pdf"],
    ["Lease.PDF", "Lease_signed.pdf"],
    ["চুক্তি.pdf", "চুক্তি_signed.pdf"],
    [".pdf", "document_signed.pdf"],
  ])("names %j like other PDF tools do", (original, name) => {
    expect(signedName(original)).toBe(name);
  });
});
