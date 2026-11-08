import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf, pageRotations, pageWidths } from "../../../tests/fixtures/pdf";
import { organizePdf, readPlan } from "./organize";

async function sizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
}

describe("organizePdf", () => {
  it("puts pages from several files in the planned order, leaving out the rest", async () => {
    const a = await makePdf([101, 102, 103]);
    const b = await makePdf([201, 202]);
    const result = await organizePdf(
      [
        { name: "a.pdf", bytes: a },
        { name: "b.pdf", bytes: b },
      ],
      [
        { file: 1, page: 2, rotate: 0 },
        { file: 0, page: 1, rotate: 0 },
        { file: 0, page: 3, rotate: 0 },
      ],
    );
    expect(await pageWidths(result.bytes)).toEqual([202, 101, 103]);
    expect(result.pageCount).toBe(3);
  });

  it("adds each turn on top of the page's own rotation", async () => {
    const source = await PDFDocument.load(await makePdf([101, 102]));
    source.getPage(1).setRotation(degrees(90));
    const result = await organizePdf(
      [{ name: "a.pdf", bytes: await source.save() }],
      [
        { file: 0, page: 1, rotate: 90 },
        { file: 0, page: 2, rotate: 270 },
      ],
    );
    expect(await pageRotations(result.bytes)).toEqual([90, 0]);
  });

  it("sizes a blank page like the page after it, as that page is shown", async () => {
    const result = await organizePdf(
      [{ name: "a.pdf", bytes: await makePdf([150, 160], 400) }],
      [
        { blank: true },
        { file: 0, page: 1, rotate: 0 },
        { file: 0, page: 2, rotate: 90 },
        { blank: true },
      ],
    );
    // The last blank follows the turned page before it, so it lies on its side too.
    expect(await sizes(result.bytes)).toEqual([
      [150, 400],
      [150, 400],
      [160, 400],
      [400, 160],
    ]);
    expect(await pageRotations(result.bytes)).toEqual([0, 0, 90, 0]);
  });

  it("makes an A4 page when there's nothing else to match", async () => {
    const result = await organizePdf([{ name: "a.pdf", bytes: await makePdf([101]) }], [{ blank: true }]);
    expect(await sizes(result.bytes)).toEqual([[595, 842]]);
  });

  it("refuses an empty plan, and names a file that can't be read", async () => {
    const a = await makePdf([101]);
    await expect(organizePdf([{ name: "a.pdf", bytes: a }], [])).rejects.toMatchObject({ code: "empty" });
    await expect(
      organizePdf([{ name: "locked.pdf", bytes: await makeEncryptedPdf() }], [{ file: 0, page: 1, rotate: 0 }]),
    ).rejects.toMatchObject({ code: "encrypted", detail: "locked.pdf" });
    await expect(
      organizePdf([{ name: "bad.pdf", bytes: new TextEncoder().encode("nope") }], [{ file: 0, page: 1, rotate: 0 }]),
    ).rejects.toMatchObject({ code: "unreadable", detail: "bad.pdf" });
  });
});

describe("readPlan", () => {
  it("keeps well-formed steps and drops the rest", () => {
    expect(
      readPlan(
        JSON.stringify([
          { file: 0, page: 2, rotate: 90 },
          { blank: true },
          { file: 0, page: 0, rotate: 0 },
          { file: 3, page: 1, rotate: 0 },
          { file: 0, page: 1, rotate: 45 },
          "nonsense",
        ]),
        2,
      ),
    ).toEqual([{ file: 0, page: 2, rotate: 90 }, { blank: true }, { file: 0, page: 1, rotate: 0 }]);
    expect(readPlan("not json", 1)).toEqual([]);
  });
});
