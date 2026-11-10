import { brightness, paperLevels, type Pixels } from "../sign-pdf/clean";

// Turns a phone photo of a page into something that looks scanned: the paper evenly white, shadows and the lamp's tint
// gone, the text dark. Colour keeps stamps and photos in colour; Black and white makes text crisp for printing.

export type ScanFilter = "original" | "color" | "bw";
export const SCAN_FILTERS: ScanFilter[] = ["color", "bw", "original"];

// Paper this dark is a dark photo, not paper: it's left as it is rather than blown out.
const DARKEST_PAPER = 60;

export function readScanFilter(value: unknown): ScanFilter {
  return SCAN_FILTERS.includes(value as ScanFilter) ? (value as ScanFilter) : "color";
}

// A tone curve: everything at or above `white` becomes white, at or below `black` becomes black, in between is stretched.
const levels = (value: number, black: number, white: number) => Math.min(255, Math.max(0, ((value - black) * 255) / (white - black)));

export function enhanceScan(source: Pixels, filter: ScanFilter): Pixels {
  if (filter === "original") return source;
  const { width, height, data } = source;
  const light = brightness(source);
  const paper = paperLevels(source, light);
  // The paper's own colour, from pixels about as bright as the paper around them: a warm lamp makes it yellow. Each
  // colour is evened out so the paper turns neutral white.
  const sums = [0, 0, 0, 0];
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (light[pixel] < paper[pixel] * 0.95) continue;
    sums[0] += data[pixel * 4];
    sums[1] += data[pixel * 4 + 1];
    sums[2] += data[pixel * 4 + 2];
    sums[3] += light[pixel];
  }
  const balance = sums.slice(0, 3).map((sum) => (sum > 0 ? Math.min(1.5, sums[3] / sum) : 1));
  const out = new Uint8ClampedArray(data.length);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const at = pixel * 4;
    // Each pixel measured against the paper around it, so shadows and uneven light even out.
    const scale = 255 / Math.max(DARKEST_PAPER, paper[pixel]);
    const r = Math.min(255, data[at] * balance[0] * scale);
    const g = Math.min(255, data[at + 1] * balance[1] * scale);
    const b = Math.min(255, data[at + 2] * balance[2] * scale);
    if (filter === "bw") {
      const grey = levels(0.299 * r + 0.587 * g + 0.114 * b, 90, 215);
      out[at] = out[at + 1] = out[at + 2] = grey;
    } else {
      out[at] = levels(r, 25, 225);
      out[at + 1] = levels(g, 25, 225);
      out[at + 2] = levels(b, 25, 225);
    }
    out[at + 3] = 255;
  }
  return { width, height, data: out };
}
