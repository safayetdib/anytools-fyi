import { PDFDocument, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { CropError, cropPdf, croppedName, readPlan } from "./crop";

async function makeDoc(pages: { size: [number, number]; turn?: number; origin?: [number, number] }[]) {
  const doc = await PDFDocument.create();
  for (const { size, turn, origin } of pages) {
    const page = doc.addPage(size);
    if (origin) page.setMediaBox(origin[0], origin[1], size[0], size[1]);
    if (turn) page.setRotation(degrees(turn));
  }
  return doc.save();
}

const boxOf = async (bytes: Uint8Array, index: number) => {
  const page = (await PDFDocument.load(bytes)).getPage(index);
  return { media: page.getMediaBox(), crop: page.getCropBox() };
};

describe("readPlan", () => {
  it("keeps one box for all pages, or a box for each page", () => {
    expect(readPlan('{"all":{"x":0.1,"y":0.1,"width":0.8,"height":0.8},"pages":[{"page":2,"box":{"x":0,"y":0,"width":0.5,"height":1}}]}')).toEqual({
      all: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      pages: [],
    });
    expect(readPlan('{"all":null,"pages":[{"page":2,"box":{"x":0,"y":0,"width":0.5,"height":1}},{"page":0,"box":{}}]}')).toEqual({
      all: null,
      pages: [{ page: 2, box: { x: 0, y: 0, width: 0.5, height: 1 } }],
    });
  });

  it("drops whole-page boxes and nonsense", () => {
    expect(readPlan('{"all":{"x":0,"y":0,"width":1,"height":1}}')).toEqual({ all: null, pages: [] });
    expect(readPlan("nope")).toEqual({ all: null, pages: [] });
    expect(readPlan('{"all":{"x":-1,"y":2,"width":9,"height":"a"}}').all).toBeNull();
  });
});

describe("cropPdf", () => {
  it("cuts every page to the same part", async () => {
    const out = await cropPdf(await makeDoc([{ size: [200, 100] }, { size: [400, 200] }]), { all: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }, pages: [] });
    expect((await boxOf(out, 0)).media).toEqual({ x: 20, y: 30, width: 100, height: 50 });
    expect((await boxOf(out, 0)).crop).toEqual({ x: 20, y: 30, width: 100, height: 50 });
    expect((await boxOf(out, 1)).media).toEqual({ x: 40, y: 60, width: 200, height: 100 });
  });

  it("cuts only the chosen pages", async () => {
    const out = await cropPdf(await makeDoc([{ size: [200, 100] }, { size: [200, 100] }]), { all: null, pages: [{ page: 2, box: { x: 0, y: 0, width: 0.5, height: 1 } }] });
    expect((await boxOf(out, 0)).media).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect((await boxOf(out, 1)).media).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("cuts the part seen on a turned page, and respects a page that doesn't start at zero", async () => {
    // Turned 90°: shown 100 wide and 200 tall. The top half as shown is the page's own right half.
    const out = await cropPdf(await makeDoc([{ size: [200, 100], turn: 90, origin: [10, 20] }]), { all: { x: 0, y: 0, width: 1, height: 0.5 }, pages: [] });
    expect((await boxOf(out, 0)).media).toEqual({ x: 10, y: 20, width: 100, height: 100 });
  });

  it("refuses an empty plan and a locked file", async () => {
    await expect(cropPdf(await makeDoc([{ size: [100, 100] }]), { all: null, pages: [] })).rejects.toBeInstanceOf(CropError);
    await expect(cropPdf(new Uint8Array([1, 2, 3]), { all: { x: 0, y: 0, width: 0.5, height: 0.5 }, pages: [] })).rejects.toMatchObject({ code: "unreadable" });
  });

  it("names the result like other tools", () => {
    expect(croppedName("report.PDF")).toBe("report_cropped.pdf");
    expect(croppedName(".pdf")).toBe("document_cropped.pdf");
  });
});
