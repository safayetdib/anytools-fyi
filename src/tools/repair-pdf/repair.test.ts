import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../tests/fixtures/pdf";
import { IN, OUT } from "../../lib/pdf/qpdf";
import { nodeQpdf } from "../../lib/pdf/qpdf-node.test-helper";
import { damage } from "../../../tests/fixtures/damage";
import { repairPdf, repairedName } from "./repair";

// A PDF saved the classic way, with a plain table of where each object starts, as most damaged files are.
async function classicPdf(widths: number[]) {
  const doc = await PDFDocument.load(await makePdf(widths, 300));
  return doc.save({ useObjectStreams: false });
}

describe("repairPdf", () => {
  it("rebuilds a file whose table of contents points to the wrong places", async () => {
    const broken = damage(await classicPdf([200, 300, 400]));
    const { bytes, fixed } = await repairPdf(nodeQpdf, broken);
    expect(fixed).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPages().map((page) => page.getWidth())).toEqual([200, 300, 400]);
  });

  it("rebuilds a file cut off before its end, as an interrupted download is", async () => {
    const whole = await classicPdf([200, 300]);
    const text = Array.from(whole, (byte) => String.fromCharCode(byte)).join("");
    const cut = Uint8Array.from(text.slice(0, text.lastIndexOf("xref")), (char) => char.charCodeAt(0));
    const { bytes, fixed } = await repairPdf(nodeQpdf, cut);
    expect(fixed).toBe(true);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });

  it("copies a healthy file as it is, saying nothing needed fixing", async () => {
    const { bytes, fixed } = await repairPdf(nodeQpdf, await makePdf([200], 300));
    expect(fixed).toBe(false);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("doesn't make a healthy file bigger", async () => {
    const bytes = await makePdf(Array.from({ length: 40 }, (_, index) => 200 + index));
    expect((await repairPdf(nodeQpdf, bytes)).bytes.length).toBeLessThan(bytes.length);
  });

  it("says when a file needs its password, or isn't a PDF at all", async () => {
    const locked = await nodeQpdf(["--encrypt", "--user-password=x", "--owner-password=x", "--bits=256", "--", IN, OUT], await makePdf([200], 300));
    await expect(repairPdf(nodeQpdf, locked.output as Uint8Array)).rejects.toMatchObject({ code: "locked" });
    await expect(repairPdf(nodeQpdf, new TextEncoder().encode("hello, not a pdf"))).rejects.toMatchObject({ code: "unreadable" });
  });

  it("names the result like other tools", () => {
    expect(repairedName("report.pdf")).toBe("report_repaired.pdf");
  });
});
