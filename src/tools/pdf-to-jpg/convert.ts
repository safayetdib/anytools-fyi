export interface Choice {
  mode: "pages" | "images";
  quality: "normal" | "high";
}

// Normal is what most PDF tools send (150 dpi); High is print quality (300 dpi).
export const QUALITY = {
  normal: { dpi: 150, jpeg: 0.85 },
  high: { dpi: 300, jpeg: 0.92 },
} as const;

// Phones refuse canvases much larger than this.
export const MAX_SIDE = 4096;
// Keeps a ZIP of pictures practical on phones.
export const MAX_IMAGES = 500;

export function readChoice(text: string): Choice {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // No choice yet: start like other tools.
  }
  return {
    mode: raw.mode === "images" ? "images" : "pages",
    quality: raw.quality === "high" ? "high" : "normal",
  };
}

// The width in pixels for a page of width × height points, at the chosen quality.
export function renderWidth(width: number, height: number, quality: Choice["quality"]): number {
  const scale = Math.min(QUALITY[quality].dpi / 72, MAX_SIDE / Math.max(width, height));
  return Math.round(width * scale);
}

// Like most PDF tools: "report_page-0001.jpg", numbered with four digits so the files sort in order.
export function jpgName(original: string, kind: "page" | "image", index: number): string {
  const base = original.replace(/\.pdf$/i, "") || "document";
  return `${base}_${kind}-${String(index).padStart(4, "0")}.jpg`;
}

// pdf.js hands over some pictures as raw pixels: 1 = one bit per pixel, 2 = RGB, 3 = RGBA.
export function pixelsToRgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number, kind: number): Uint8ClampedArray {
  if (kind === 3) return new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(width * height * 4);
  if (kind === 2) {
    for (let pixel = 0; pixel < width * height; pixel++) {
      out[pixel * 4] = data[pixel * 3];
      out[pixel * 4 + 1] = data[pixel * 3 + 1];
      out[pixel * 4 + 2] = data[pixel * 3 + 2];
      out[pixel * 4 + 3] = 255;
    }
    return out;
  }
  // One bit per pixel, each row padded to a whole byte.
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const at = (y * width + x) * 4;
      out[at] = out[at + 1] = out[at + 2] = on ? 255 : 0;
      out[at + 3] = 255;
    }
  }
  return out;
}
