import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makePdf } from "../../../tests/fixtures/pdf";
import { DEFAULT_SETTINGS, labelFor, numberPdf, numberedName, numbering, onLeft, place, readSettings, type Settings } from "./numbers";

const settings = (overrides: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...overrides });

// The text on each page with where it starts, read back the way a PDF reader sees it.
async function texts(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items as { str: string; transform: number[] }[];
    pages.push(
      items
        .filter((item) => item.str.trim())
        .map((item) => {
          // Where the text starts as the page is shown, from its bottom-left corner.
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          return { text: item.str, x: Math.round(x), y: Math.round(viewport.height - y) };
        }),
    );
  }
  await task.destroy();
  return pages;
}

describe("readSettings", () => {
  it("starts like other tools: bottom right, Recommended, only the number", () => {
    expect(readSettings("")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: "single", vertical: "bottom", horizontal: "right", margin: "recommended", text: "number", size: 14, color: "#000000", first: 1, from: 1 });
  });

  it("keeps known choices and fixes the rest", () => {
    const read = readSettings(JSON.stringify({ vertical: "top", size: 500, first: -3, color: "red", text: "custom", custom: "Sheet {n}" }));
    expect(read).toMatchObject({ vertical: "top", size: 72, first: 0, color: "#000000", text: "custom", custom: "Sheet {n}" });
  });
});

describe("labelFor", () => {
  it.each([
    ["number", "", "3"],
    ["page", "", "Page 3"],
    ["pageOf", "", "Page 3 of 11"],
    ["custom", "{n} / {p}", "3 / 11"],
    ["custom", "", "3"],
  ] as const)("writes %s as %j", (text, custom, label) => {
    expect(labelFor(settings({ text, custom }), 3, 11)).toBe(label);
  });
});

describe("numbering", () => {
  it("numbers from page to page, starting at the first number, with {p} as the last number", () => {
    expect(numbering(settings({ from: 2, to: 4, first: 1 }), 5)).toEqual({ pages: [{ page: 2, n: 1 }, { page: 3, n: 2 }, { page: 4, n: 3 }], last: 3 });
    expect(numbering(settings({ from: 1, to: null, first: 10 }), 2)).toEqual({ pages: [{ page: 1, n: 10 }, { page: 2, n: 11 }], last: 11 });
    // A range past the end stops at the last page.
    expect(numbering(settings({ from: 3, to: 9 }), 4).pages.map((p) => p.page)).toEqual([3, 4]);
  });
});

describe("onLeft", () => {
  it("puts odd pages on the left of a spread, or even ones after a cover", () => {
    expect([1, 2, 3, 4].map((page) => onLeft(page, settings({ mode: "facing" })))).toEqual([true, false, true, false]);
    expect([1, 2, 3, 4].map((page) => onLeft(page, settings({ mode: "facing", cover: true })))).toEqual([false, true, false, true]);
    expect(onLeft(1, settings())).toBe(false);
  });
});

describe("place", () => {
  it("puts the text in each of the nine spots, a margin away from the edges", () => {
    const at = (vertical: Settings["vertical"], horizontal: Settings["horizontal"], margin: Settings["margin"] = "recommended") =>
      place(600, 800, 20, 10, settings({ vertical, horizontal, margin }), false);
    expect(at("bottom", "right")).toEqual({ x: 562, y: 18 });
    expect(at("bottom", "left", "small")).toEqual({ x: 10, y: 10 });
    expect(at("top", "center", "big")).toEqual({ x: 290, y: 754 });
    expect(at("middle", "left")).toEqual({ x: 18, y: 395 });
  });

  it("swaps left and right on the left page of a spread", () => {
    expect(place(600, 800, 20, 10, settings({ horizontal: "right" }), true)).toEqual({ x: 18, y: 18 });
    expect(place(600, 800, 20, 10, settings({ horizontal: "center" }), true)).toEqual({ x: 290, y: 18 });
  });
});

describe("numberPdf", () => {
  it("writes each number as real text at the bottom right of each page", async () => {
    const bytes = await numberPdf(await makePdf([595, 595, 595], 842), settings());
    const pages = await texts(bytes);
    expect(pages.map((page) => page.map((item) => item.text))).toEqual([["1"], ["2"], ["3"]]);
    // 595 wide, 18 pt margin, a 14 pt "1" about 8 pt wide.
    expect(pages[0][0].y).toBe(18);
    expect(pages[0][0].x).toBeGreaterThan(560);
    expect(pages[0][0].x).toBeLessThan(570);
  });

  it("leaves pages outside the range alone and counts {p} from the numbers printed", async () => {
    const bytes = await numberPdf(await makePdf([300, 300, 300, 300], 400), settings({ from: 2, to: 3, text: "pageOf" }));
    expect((await texts(bytes)).map((page) => page.map((item) => item.text).join(" "))).toEqual(["", "Page 1 of 2", "Page 2 of 2", ""]);
  });

  it("keeps numbers upright and in place on turned pages", async () => {
    const source = await PDFDocument.load(await makePdf([300, 300], 400));
    source.getPage(1).setRotation(degrees(90));
    const pages = await texts(await numberPdf(await source.save(), settings({ horizontal: "left" })));
    // The turned page is shown 400 wide and 300 tall; its number still sits at the bottom left.
    expect(pages[1][0]).toMatchObject({ text: "2", x: 18, y: 18 });
    expect(pages[0][0]).toMatchObject({ text: "1", x: 18, y: 18 });
  });

  it("mirrors facing pages to their outer edges", async () => {
    const pages = await texts(await numberPdf(await makePdf([300, 300], 400), settings({ mode: "facing" })));
    expect(pages[0][0].x).toBe(18);
    expect(pages[1][0].x).toBeGreaterThan(270);
  });

  it("refuses text the built-in fonts can't draw, before changing anything", async () => {
    await expect(numberPdf(await makePdf([300], 400), settings({ text: "custom", custom: "পৃষ্ঠা {n}" }))).rejects.toMatchObject({ code: "text" });
  });
});

describe("numberedName", () => {
  it("names files like other PDF tools do", () => {
    expect(numberedName("report.pdf")).toBe("report_pagenumber.pdf");
    expect(numberedName(".pdf")).toBe("document_pagenumber.pdf");
  });
});
