import { describe, expect, it } from "vitest";
import { QUALITY, pictureName, pixelsToRgba, readChoice, renderWidth } from "./convert";

describe("pictureName", () => {
  it.each([
    ["report.pdf", "page", 1, "report_page-0001.jpg"],
    ["report.pdf", "page", 12, "report_page-0012.jpg"],
    ["Scan.PDF", "image", 3, "Scan_image-0003.jpg"],
    ["ছবি.pdf", "page", 1, "ছবি_page-0001.jpg"],
    [".pdf", "page", 1, "document_page-0001.jpg"],
  ] as const)("names %j %s %i like other PDF tools do", (original, kind, index, name) => {
    expect(pictureName(original, kind, index)).toBe(name);
  });
});

describe("pictureName for PNG", () => {
  it("ends PNG pictures in .png", () => {
    expect(pictureName("report.pdf", "page", 2, "png")).toBe("report_page-0002.png");
    expect(pictureName("Scan.PDF", "image", 1, "png")).toBe("Scan_image-0001.png");
  });
});

describe("renderWidth", () => {
  it("draws Normal at 150 dpi and High at 300 dpi", () => {
    expect(renderWidth(595, 842, "normal")).toBe(1240);
    expect(renderWidth(595, 842, "high")).toBe(2479);
  });

  it("keeps the longest side within 4,096 pixels", () => {
    expect(renderWidth(2000, 1000, "high")).toBe(4096);
    expect(renderWidth(1000, 2000, "high")).toBe(2048);
  });

  it("uses a finer JPG setting for High", () => {
    expect(QUALITY.normal.jpeg).toBeLessThan(QUALITY.high.jpeg);
  });
});

describe("pixelsToRgba", () => {
  it("turns grey, colour and see-through pixels into RGBA", () => {
    expect([...pixelsToRgba(new Uint8ClampedArray([0, 2, 4, 6, 8, 10]), 2, 1, 2)]).toEqual([0, 2, 4, 255, 6, 8, 10, 255]);
    expect([...pixelsToRgba(new Uint8ClampedArray([1, 2, 3, 128]), 1, 1, 3)]).toEqual([1, 2, 3, 128]);
    // One bit per pixel, a row padded to a whole byte: 1 is white and 0 black.
    expect([...pixelsToRgba(new Uint8ClampedArray([0b10000000]), 2, 1, 1)]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
  });
});

describe("readChoice", () => {
  it("keeps known choices and starts like other tools", () => {
    expect(readChoice('{"mode":"images","quality":"high","background":"transparent"}')).toEqual({ mode: "images", quality: "high", background: "transparent" });
    expect(readChoice('{"mode":"x","background":"pink"}')).toEqual({ mode: "pages", quality: "normal", background: "white" });
    expect(readChoice("")).toEqual({ mode: "pages", quality: "normal", background: "white" });
  });
});
