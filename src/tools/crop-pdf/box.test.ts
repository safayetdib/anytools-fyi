import { describe, expect, it } from "vitest";
import { MIN_SIDE, boxFromMargins, dragBox, inkBox, marginsOf, nudgeBox } from "./box";

const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
const close = (actual: object, expected: Record<string, number>) => {
  for (const key of Object.keys(expected)) expect((actual as Record<string, number>)[key]).toBeCloseTo(expected[key], 4);
};

describe("dragBox", () => {
  it("moves the whole box, stopping at the page edge", () => {
    close(dragBox(box, "move", 0.1, -0.1), { x: 0.2, y: 0.1, width: 0.5, height: 0.4 });
    close(dragBox(box, "move", 1, 1), { x: 0.5, y: 0.6, width: 0.5, height: 0.4 });
  });

  it("moves only the dragged sides", () => {
    close(dragBox(box, "w", -0.05, 0.3), { x: 0.05, y: 0.2, width: 0.55, height: 0.4 });
    close(dragBox(box, "s", 0.3, 0.1), { x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    close(dragBox(box, "ne", 0.1, -0.1), { x: 0.1, y: 0.1, width: 0.6, height: 0.5 });
  });

  it("keeps the box on the page and never smaller than the minimum", () => {
    close(dragBox(box, "nw", -1, -1), { x: 0, y: 0, width: 0.6, height: 0.6 });
    close(dragBox(box, "e", -1, 0), { width: MIN_SIDE });
    close(dragBox(box, "n", 0, 1), { y: 0.6 - MIN_SIDE, height: MIN_SIDE });
  });
});

describe("nudgeBox", () => {
  it("moves with arrows and resizes with Shift", () => {
    close(nudgeBox(box, "ArrowRight", false) as never, { x: 0.11, width: 0.5 });
    close(nudgeBox(box, "ArrowUp", true) as never, { y: 0.2, height: 0.39 });
    expect(nudgeBox(box, "Enter", false)).toBeNull();
  });
});

describe("margins", () => {
  // A4 in points.
  const [width, height] = [595.28, 841.89];

  it("reads the cut from each side in millimetres", () => {
    expect(marginsOf({ x: 0.1, y: 0.05, width: 0.8, height: 0.9 }, width, height)).toEqual({ top: 14.9, bottom: 14.9, left: 21, right: 21 });
    expect(marginsOf({ x: 0, y: 0, width: 1, height: 1 }, width, height)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it("turns margins back into a box", () => {
    close(boxFromMargins({ top: 14.85, bottom: 14.85, left: 21, right: 21 }, width, height) as never, { x: 0.1, y: 0.05, width: 0.8, height: 0.9 });
  });

  it("never lets margins swallow the page, and ignores blanks", () => {
    const huge = boxFromMargins({ top: 500, bottom: 500, left: Number.NaN, right: -4 }, width, height);
    expect(huge.width).toBe(1);
    expect(huge.height).toBeCloseTo(MIN_SIDE, 6);
    expect(huge.y + huge.height).toBeLessThanOrEqual(1);
  });
});

describe("inkBox", () => {
  // A 100 by 50 white page with a black block from (20, 10) to (59, 29).
  const page = (fill: (x: number, y: number) => boolean) => {
    const pixels = new Uint8ClampedArray(100 * 50 * 4).fill(255);
    for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) if (fill(x, y)) pixels.fill(0, (y * 100 + x) * 4, (y * 100 + x) * 4 + 3);
    return pixels;
  };

  it("finds what's printed and leaves a little room around it", () => {
    close(inkBox(page((x, y) => x >= 20 && x < 60 && y >= 10 && y < 30), 100, 50, 0) as never, { x: 0.2, y: 0.2, width: 0.4, height: 0.4 });
    close(inkBox(page((x, y) => x >= 20 && x < 60 && y >= 10 && y < 30), 100, 50, 0.02) as never, { x: 0.18, y: 0.18, width: 0.44, height: 0.44 });
  });

  it("finds nothing on a blank page", () => {
    expect(inkBox(page(() => false), 100, 50)).toBeNull();
  });
});
