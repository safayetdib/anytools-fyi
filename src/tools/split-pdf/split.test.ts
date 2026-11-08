import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf, pageWidths } from "../../../tests/fixtures/pdf";
import { splitPdf, zipParts } from "./split";

const noProgress = () => {};

describe("splitPdf", () => {
  it("makes one PDF per range, with the right pages in order", async () => {
    const result = await splitPdf(
      await makePdf([101, 102, 103, 104, 105]),
      { mode: "ranges", ranges: [{ from: 1, to: 2 }, { from: 4, to: 5 }], merge: false },
      "report.pdf",
      noProgress,
    );
    expect(result.names).toEqual(["report-1-2.pdf", "report-4-5.pdf"]);
    expect(await Promise.all(result.parts.map((part) => pageWidths(part)))).toEqual([[101, 102], [104, 105]]);
  });

  it("merges ranges into one PDF", async () => {
    const result = await splitPdf(
      await makePdf([101, 102, 103, 104]),
      { mode: "ranges", ranges: [{ from: 3, to: 4 }, { from: 1, to: 1 }], merge: true },
      "report.pdf",
      noProgress,
    );
    expect(result.names).toEqual(["report-extracted.pdf"]);
    expect(await pageWidths(result.parts[0])).toEqual([103, 104, 101]);
  });

  it("extracts selected pages", async () => {
    const result = await splitPdf(await makePdf([101, 102, 103]), { mode: "select", pages: "1,3", merge: false }, "a.pdf", noProgress);
    expect(result.names).toEqual(["a-1.pdf", "a-3.pdf"]);
    expect(await pageWidths(result.parts[1])).toEqual([103]);
  });

  it("reports progress that rises to 1", async () => {
    const seen: number[] = [];
    await splitPdf(await makePdf([1, 2, 3]), { mode: "all" }, "a.pdf", (value) => seen.push(value));
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("explains bad ranges with the page count", async () => {
    await expect(
      splitPdf(await makePdf([1, 2]), { mode: "select", pages: "4-9", merge: false }, "a.pdf", noProgress),
    ).rejects.toMatchObject({ code: "range", detail: "empty||2" });
    await expect(splitPdf(await makePdf(Array(301).fill(50)), { mode: "all" }, "a.pdf", noProgress)).rejects.toMatchObject({
      detail: "tooMany||301",
    });
  });

  it("explains password-protected and broken files", async () => {
    await expect(splitPdf(await makeEncryptedPdf(), { mode: "all" }, "a.pdf", noProgress)).rejects.toMatchObject({ code: "encrypted" });
    await expect(splitPdf(new Uint8Array([1, 2, 3]), { mode: "all" }, "a.pdf", noProgress)).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("splitPdf by size", () => {
  it("keeps every file under the limit, in page order, without losing pages", async () => {
    const bytes = await makePdf(Array.from({ length: 12 }, (_, i) => 100 + i));
    // Room for about three pages: one page's size, plus two and a half times what each extra page adds.
    const single = (await splitPdf(bytes, { mode: "all" }, "a.pdf", noProgress)).parts[0].length;
    const whole = (await splitPdf(bytes, { mode: "ranges", ranges: [{ from: 1, to: 12 }], merge: false }, "a.pdf", noProgress)).parts[0].length;
    const maxBytes = Math.floor(single + ((whole - single) / 11) * 2.5);
    const result = await splitPdf(bytes, { mode: "size", maxBytes }, "a.pdf", noProgress);
    expect(result.parts.every((part) => part.length <= maxBytes)).toBe(true);
    expect(result.outputs.flat()).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.length).toBeLessThan(12);
    expect(result.names[0]).toBe("a-1.pdf");
    expect(result.oversize).toBe(0);
  });

  it("puts a page that's too big on its own into its own file, and counts it", async () => {
    const result = await splitPdf(await makePdf([100, 101, 102]), { mode: "size", maxBytes: 10 }, "a.pdf", noProgress);
    expect(result.outputs).toEqual([[1], [2], [3]]);
    expect(result.oversize).toBe(3);
  });

  it("makes one file when everything fits", async () => {
    const result = await splitPdf(await makePdf([100, 101]), { mode: "size", maxBytes: 10 * 1024 * 1024 }, "a.pdf", noProgress);
    expect(result.outputs).toEqual([[1, 2]]);
  });
});

describe("zipParts", () => {
  it("packs every part under its own name", async () => {
    const a = await makePdf([10]);
    const b = await makePdf([20, 30]);
    const files = unzipSync(zipParts([{ name: "x-1.pdf", bytes: a }, { name: "x-2.pdf", bytes: b }]));
    expect(Object.keys(files)).toEqual(["x-1.pdf", "x-2.pdf"]);
    expect(await pageWidths(files["x-2.pdf"])).toEqual([20, 30]);
  });

  it("keeps names unique", () => {
    const one = new Uint8Array([1]);
    const files = unzipSync(zipParts([{ name: "a.pdf", bytes: one }, { name: "a.pdf", bytes: one }]));
    expect(Object.keys(files)).toEqual(["a.pdf", "a (2).pdf"]);
  });
});
