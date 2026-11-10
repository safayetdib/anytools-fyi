import { describe, expect, it } from "vitest";
import { enhanceScan, readScanFilter } from "./enhance";

// A 120 by 80 photo of a page: paper that fades from bright on the left to a grey shadow on the right, with a dark
// line of "text" across the middle and a red stamp near the left.
function photo() {
  const width = 120;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const paper = 230 - x; // 230 on the left, 111 in the shadow
      let rgb = [paper, paper * 0.96, paper * 0.88]; // a warm lamp tints the light
      if (y >= 38 && y < 42 && x >= 10 && x < 110) rgb = [paper * 0.25, paper * 0.25, paper * 0.25];
      if (y >= 10 && y < 20 && x >= 10 && x < 20) rgb = [paper, paper * 0.3, paper * 0.3];
      data.set([...rgb, 255], at);
    }
  }
  return { width, height, data };
}
const pixel = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));

describe("enhanceScan", () => {
  it("makes paper white on both sides of a shadow, and the lamp's tint goes", () => {
    const out = enhanceScan(photo(), "color");
    for (const x of [5, 60, 115]) expect(pixel(out, x, 70)).toEqual([255, 255, 255]);
  });

  it("keeps text dark and a stamp red in Colour", () => {
    const out = enhanceScan(photo(), "color");
    for (const x of [15, 60, 105]) expect(Math.max(...pixel(out, x, 40))).toBeLessThan(60);
    const [r, g, b] = pixel(out, 15, 15);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(80);
    expect(b).toBeLessThan(80);
  });

  it("makes black text on white paper in Black and white", () => {
    const out = enhanceScan(photo(), "bw");
    expect(pixel(out, 60, 40)).toEqual([0, 0, 0]);
    expect(pixel(out, 110, 70)).toEqual([255, 255, 255]);
    const [r, g, b] = pixel(out, 15, 15);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("leaves Original untouched", () => {
    const source = photo();
    expect(enhanceScan(source, "original")).toBe(source);
  });

  it("reads the chosen filter, starting on Colour", () => {
    expect(readScanFilter("bw")).toBe("bw");
    expect(readScanFilter("sepia")).toBe("color");
  });
});
