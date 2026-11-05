import { describe, expect, it } from "vitest";
import { fromScreen, isFullPage, toScreen, type CropRect } from "./crop";

const close = (a: CropRect, b: CropRect) => {
  for (const key of ["x", "y", "width", "height"] as const) expect(a[key]).toBeCloseTo(b[key], 6);
};

describe("crop coordinates", () => {
  // A crop of the page's top-left corner, as fractions of the unturned page.
  const corner: CropRect = { x: 0, y: 0, width: 0.5, height: 0.25 };

  it.each([
    [0, { x: 0, y: 0, width: 0.5, height: 0.25 }],
    [90, { x: 0.75, y: 0, width: 0.25, height: 0.5 }],
    [180, { x: 0.5, y: 0.75, width: 0.5, height: 0.25 }],
    [270, { x: 0, y: 0.5, width: 0.25, height: 0.5 }],
  ])("shows a crop on a page turned %d degrees in the right place", (turn, expected) => {
    close(toScreen(corner, turn), expected);
  });

  it.each([0, 90, 180, 270])("converts back from the screen exactly at %d degrees", (turn) => {
    const crop: CropRect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    close(fromScreen(toScreen(crop, turn), turn), crop);
  });

  it("knows when a crop keeps the whole page", () => {
    expect(isFullPage({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isFullPage({ x: 0.001, y: 0, width: 0.999, height: 1 })).toBe(true);
    expect(isFullPage({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });
});
