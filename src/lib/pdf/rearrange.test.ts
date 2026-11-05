import { describe, expect, it } from "vitest";
import { makePdf, pageRotations, pageSizes, pageWidths } from "../../../tests/fixtures/pdf";
import type { PagePlan } from "../shell/types";
import { rearrangePdf } from "./rearrange";

const keep = (pages: number[]): PagePlan["pages"] => pages.map((page) => ({ page, rotate: 0 }));

describe("rearrangePdf", () => {
  it("keeps only the listed pages, in the listed order", async () => {
    const source = await makePdf([100, 200, 300, 400]);
    const result = await rearrangePdf(source, { pages: keep([4, 1, 3]), pageSize: "original" });
    expect(result.pageCount).toBe(3);
    expect(await pageWidths(result.bytes)).toEqual([400, 100, 300]);
  });

  it("refuses an empty or out-of-range plan", async () => {
    const source = await makePdf([100, 200]);
    await expect(rearrangePdf(source, { pages: [], pageSize: "original" })).rejects.toThrow();
    await expect(rearrangePdf(source, { pages: keep([3]), pageSize: "original" })).rejects.toThrow();
  });

  it("turns pages without changing their size", async () => {
    const source = await makePdf([100, 200]);
    const result = await rearrangePdf(source, {
      pages: [
        { page: 1, rotate: 90 },
        { page: 2, rotate: 270 },
      ],
      pageSize: "original",
    });
    expect(await pageRotations(result.bytes)).toEqual([90, 270]);
    expect(await pageWidths(result.bytes)).toEqual([100, 200]);
  });

  it("adds to a page's own rotation", async () => {
    const turned = await rearrangePdf(await makePdf([100]), { pages: [{ page: 1, rotate: 270 }], pageSize: "original" });
    const again = await rearrangePdf(turned.bytes, { pages: [{ page: 1, rotate: 180 }], pageSize: "original" });
    expect(await pageRotations(again.bytes)).toEqual([90]);
  });

  it("puts every page on an A4 portrait sheet", async () => {
    const source = await makePdf([100, 500], 200);
    const result = await rearrangePdf(source, { pages: keep([1, 2]), pageSize: "a4-portrait" });
    expect(await pageSizes(result.bytes)).toEqual([
      [595, 842],
      [595, 842],
    ]);
    expect(await pageRotations(result.bytes)).toEqual([0, 0]);
  });

  it("puts every page on a Letter landscape sheet", async () => {
    const result = await rearrangePdf(await makePdf([100]), { pages: keep([1]), pageSize: "letter-landscape" });
    expect(await pageSizes(result.bytes)).toEqual([[792, 612]]);
  });

  it("matches each page's shape, after turning it", async () => {
    // Page 1 is tall, page 2 is wide, and page 3 is wide but turned upright.
    const source = await makePdf([100, 500, 500], 300);
    const result = await rearrangePdf(source, {
      pages: [
        { page: 1, rotate: 0 },
        { page: 2, rotate: 0 },
        { page: 3, rotate: 90 },
      ],
      pageSize: "a4-auto",
    });
    expect(await pageSizes(result.bytes)).toEqual([
      [595, 842],
      [842, 595],
      [595, 842],
    ]);
  });
});

describe("rearrangePdf with blank pages", () => {
  it("gives a page with nothing on it an empty sheet", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    doc.addPage([500, 200]);
    const result = await rearrangePdf(await doc.save(), { pages: [{ page: 1, rotate: 0 }], pageSize: "a4-auto" });
    expect(await pageSizes(result.bytes)).toEqual([[842, 595]]);
  });
});

describe("rearrangePdf with crops", () => {
  it("crops a page without changing its content", async () => {
    const { pageCropBoxes } = await import("../../../tests/fixtures/pdf");
    const source = await makePdf([200, 200], 300);
    const result = await rearrangePdf(source, {
      pages: [
        { page: 1, rotate: 0, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } },
        { page: 2, rotate: 0, crop: { x: 0, y: 0, width: 0.5, height: 0.5 } },
      ],
      pageSize: "original",
    });
    // PDF boxes are measured from the bottom-left corner, so the top half starts 150 points up.
    expect(await pageCropBoxes(result.bytes)).toEqual([
      [100, 0, 100, 300],
      [0, 150, 100, 150],
    ]);
    expect(await pageWidths(result.bytes)).toEqual([200, 200]);
  });

  it("crops inside an existing crop", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { pageCropBoxes } = await import("../../../tests/fixtures/pdf");
    const doc = await PDFDocument.load(await makePdf([200], 300));
    doc.getPage(0).setCropBox(50, 50, 100, 200);
    const result = await rearrangePdf(await doc.save(), {
      pages: [{ page: 1, rotate: 0, crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }],
      pageSize: "original",
    });
    expect(await pageCropBoxes(result.bytes)).toEqual([[100, 50, 50, 200]]);
  });

  it("places only the cropped area on a standard sheet", async () => {
    // Cropping a tall page to a wide strip makes it a landscape sheet when matching each page.
    const source = await makePdf([200], 600);
    const result = await rearrangePdf(source, {
      pages: [{ page: 1, rotate: 0, crop: { x: 0, y: 0, width: 1, height: 0.2 } }],
      pageSize: "a4-auto",
    });
    expect(await pageSizes(result.bytes)).toEqual([[842, 595]]);
  });
});
