import { describe, expect, it } from "vitest";
import { DEFAULT_CLEAN, FILTERS, type CleanSettings, type Pixels, cleanSignature, readClean } from "./clean";

// A photo of a signature on paper: grey paper with a soft shadow, and a dark blue stroke in the middle.
function photo({ paper = 205, ink = [20, 30, 120] as number[], shadow = 0 } = {}): Pixels {
  const width = 200;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const stroke = x >= 60 && x < 140 && y >= 40 && y < 60;
      // The shadow darkens the left edge, like a phone held over the page.
      const level = paper - (x < 30 ? shadow : 0);
      const [r, g, b] = stroke ? ink : [level, level, level - 5];
      data.set([r, g, b, 255], at);
    }
  }
  return { data, width, height };
}

const settings = (changes: Partial<CleanSettings> = {}): CleanSettings => ({ ...DEFAULT_CLEAN, ...changes });
const pixel = (image: Pixels, x: number, y: number) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));
const centre = (image: Pixels) => pixel(image, Math.floor(image.width / 2), Math.floor(image.height / 2));

describe("readClean", () => {
  it("starts on Clean with the pen's own colour", () => {
    expect(readClean("")).toEqual(DEFAULT_CLEAN);
    expect(DEFAULT_CLEAN.filter).toBe("clean");
    expect(DEFAULT_CLEAN.ink).toBe("original");
  });

  it("keeps values in range and ignores nonsense", () => {
    const read = readClean(JSON.stringify({ filter: "bold", removal: 400, contrast: -3, thickness: 9, ink: "#1A2B3C", turn: 90 }));
    expect(read).toEqual({ filter: "bold", removal: 100, contrast: 0, thickness: 3, ink: "#1a2b3c", turn: 90 });
    expect(readClean(JSON.stringify({ filter: "sepia", ink: "blue", turn: 45 }))).toEqual(DEFAULT_CLEAN);
  });

  it("gives each filter its own starting values", () => {
    expect(FILTERS.bold.contrast).toBeGreaterThan(FILTERS.clean.contrast);
    expect(FILTERS.bold.thickness).toBeGreaterThan(FILTERS.clean.thickness);
  });
});

describe("cleanSignature", () => {
  it("makes the paper see-through and keeps the ink solid, cropped to the signature", () => {
    const out = cleanSignature(photo(), settings()) as Pixels;
    // The stroke is 80 × 20; the crop keeps it with a small margin.
    expect(out.width).toBeGreaterThanOrEqual(80);
    expect(out.width).toBeLessThan(100);
    expect(out.height).toBeLessThan(40);
    expect(centre(out)).toEqual([20, 30, 120, 255]);
    expect(pixel(out, 0, 0)[3]).toBe(0);
  });

  it("removes shadows on the paper", () => {
    const out = cleanSignature(photo({ shadow: 40 }), settings()) as Pixels;
    // The shadow is outside the crop, so nothing beside the stroke survives.
    expect(out.width).toBeLessThan(100);
  });

  it("removes a dark, soft shadow across a corner, like a phone held over the paper", () => {
    const width = 600;
    const height = 350;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Paper fades from 207 down to 140 towards the bottom-left corner.
        const fade = Math.max(0, 1 - Math.hypot(x - 50, y - 325) / 350);
        let level = 207 - 67 * fade;
        // A thin stroke: under 1% of the picture.
        if (Math.abs(y - (120 + 40 * Math.sin(x / 30))) < 2 && x > 150 && x < 500) level = 55;
        data.set([level, level, level + 4, 255], (y * width + x) * 4);
      }
    }
    const out = cleanSignature({ data, width, height }, settings()) as Pixels;
    // Cropped to the stroke (350 × 80 with a margin), not stretched to take in the shadow.
    expect(out.width).toBeLessThan(400);
    expect(out.height).toBeLessThan(120);
  });

  it("keeps more of the shadow with less removal and no contrast", () => {
    const strong = cleanSignature(photo({ shadow: 40 }), settings({ removal: 100, contrast: 0 })) as Pixels;
    const none = cleanSignature(photo({ shadow: 40 }), settings({ removal: 0, contrast: 0 })) as Pixels;
    expect(none.width).toBeGreaterThan(strong.width);
  });

  it("turns faint pencil into solid ink", () => {
    const out = cleanSignature(photo({ paper: 225, ink: [160, 160, 160] }), settings({ ink: "#000000" })) as Pixels;
    expect(centre(out)).toEqual([0, 0, 0, 255]);
  });

  it("paints the ink in the chosen colour", () => {
    const out = cleanSignature(photo(), settings({ ink: "#1f4fd1" })) as Pixels;
    expect(centre(out)).toEqual([0x1f, 0x4f, 0xd1, 255]);
  });

  it("makes thin strokes thicker", () => {
    const thin = cleanSignature(photo(), settings()) as Pixels;
    const thick = cleanSignature(photo(), settings({ thickness: 3 })) as Pixels;
    const solid = (image: Pixels) => {
      let count = 0;
      for (let at = 3; at < image.data.length; at += 4) if (image.data[at] > 200) count++;
      return count;
    };
    expect(solid(thick)).toBeGreaterThan(solid(thin));
    // New ink takes the pen's colour, not black or grey.
    const row = Math.floor(thick.height / 2);
    const first = Array.from({ length: thick.width }, (_, x) => pixel(thick, x, row)).find((value) => value[3] > 200);
    expect(first?.slice(0, 3)).toEqual([20, 30, 120]);
  });

  it("turns the signature a quarter turn clockwise", () => {
    const flat = cleanSignature(photo(), settings()) as Pixels;
    const turned = cleanSignature(photo(), settings({ turn: 90 })) as Pixels;
    expect([turned.width, turned.height]).toEqual([flat.height, flat.width]);
    // The top-left corner moves to the top-right.
    expect(pixel(turned, turned.width - 1, 0)).toEqual(pixel(flat, 0, 0));
  });

  it("keeps the photo as it is with the Original filter", () => {
    const source = photo();
    const out = cleanSignature(source, settings({ filter: "original" })) as Pixels;
    expect([out.width, out.height]).toEqual([200, 100]);
    expect(pixel(out, 0, 0)).toEqual([205, 205, 200, 255]);
  });

  it("finds no signature on blank paper", () => {
    expect(cleanSignature(photo({ ink: [205, 205, 200] }), settings())).toBeNull();
  });

  it("treats see-through parts of a PNG as paper", () => {
    const source = photo();
    for (let at = 0; at < source.data.length; at += 4) if (source.data[at] > 100) source.data[at + 3] = 0;
    const out = cleanSignature(source, settings()) as Pixels;
    expect(centre(out)).toEqual([20, 30, 120, 255]);
    expect(pixel(out, 0, 0)[3]).toBe(0);
  });
});
