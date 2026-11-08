import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf, pageRotations, pageWidths } from "../../../tests/fixtures/pdf";
import { quarterTurns, rotatePdf, rotatedName } from "./rotate";

describe("quarterTurns", () => {
  it.each([
    [0, 90, 90],
    [90, 90, 180],
    [270, 90, 0],
    [0, -90, 270],
    [90, -90, 0],
    [180, 450, 270],
  ])("turns %i by %i to %i", (angle, turn, result) => {
    expect(quarterTurns(angle, turn)).toBe(result);
  });
});

describe("rotatedName", () => {
  it.each([
    ["report.pdf", "report_rotated.pdf"],
    ["Scan.PDF", "Scan_rotated.pdf"],
    ["১৯৭১.pdf", "১৯৭১_rotated.pdf"],
    [".pdf", "document_rotated.pdf"],
  ])("names %j like other PDF tools do", (original, name) => {
    expect(rotatedName(original)).toBe(name);
  });
});

describe("rotatePdf", () => {
  it("turns every page, keeping their order", async () => {
    const result = await rotatePdf(await makePdf([101, 102, 103]), 90);
    expect(await pageRotations(result.bytes)).toEqual([90, 90, 90]);
    expect(await pageWidths(result.bytes)).toEqual([101, 102, 103]);
    expect(result.pageCount).toBe(3);
  });

  it("adds the turn on top of each page's own rotation", async () => {
    const source = await PDFDocument.load(await makePdf([101, 102]));
    source.getPage(1).setRotation(degrees(90));
    const result = await rotatePdf(await source.save(), -90);
    expect(await pageRotations(result.bytes)).toEqual([270, 0]);
  });

  it("explains password-protected and unreadable files", async () => {
    await expect(rotatePdf(await makeEncryptedPdf(), 90)).rejects.toMatchObject({ code: "encrypted" });
    await expect(rotatePdf(new TextEncoder().encode("not a pdf"), 90)).rejects.toMatchObject({ code: "unreadable" });
  });
});
