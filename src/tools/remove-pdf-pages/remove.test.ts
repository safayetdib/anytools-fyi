import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf, pageWidths } from "../../../tests/fixtures/pdf";
import { removePages, removedName } from "./remove";

describe("removedName", () => {
  it.each([
    ["report.pdf", "report_removed.pdf"],
    ["Scan.PDF", "Scan_removed.pdf"],
    ["১৯৭১.pdf", "১৯৭১_removed.pdf"],
    [".pdf", "document_removed.pdf"],
  ])("names %j like other PDF tools do", (original, name) => {
    expect(removedName(original)).toBe(name);
  });
});

describe("removePages", () => {
  it("removes the listed pages and keeps the rest in order", async () => {
    const result = await removePages(await makePdf([101, 102, 103, 104, 105, 106, 107]), "2,5-6");
    expect(await pageWidths(result.bytes)).toEqual([101, 103, 104, 107]);
    expect(result).toMatchObject({ removed: 3, pageCount: 4 });
  });

  it("reads lists the way the page box does: to the end, en dashes, repeats and pages past the end", async () => {
    const result = await removePages(await makePdf([101, 102, 103, 104, 105]), "4-, 1–1, 1, 30");
    expect(await pageWidths(result.bytes)).toEqual([102, 103]);
    expect(result.removed).toBe(3);
  });

  it("keeps the document's own details", async () => {
    const source = await PDFDocument.load(await makePdf([101, 102]));
    source.setTitle("Annual report");
    const result = await removePages(await source.save(), "1");
    expect((await PDFDocument.load(result.bytes)).getTitle()).toBe("Annual report");
  });

  it("refuses an empty list, and a list that would leave no pages", async () => {
    const bytes = await makePdf([101, 102]);
    await expect(removePages(bytes, "")).rejects.toMatchObject({ code: "empty" });
    await expect(removePages(bytes, "9")).rejects.toMatchObject({ code: "empty" });
    await expect(removePages(bytes, "1-2")).rejects.toMatchObject({ code: "all" });
  });

  it("explains password-protected and unreadable files", async () => {
    await expect(removePages(await makeEncryptedPdf(), "1")).rejects.toMatchObject({ code: "encrypted" });
    await expect(removePages(new TextEncoder().encode("not a pdf"), "1")).rejects.toMatchObject({ code: "unreadable" });
  });
});
