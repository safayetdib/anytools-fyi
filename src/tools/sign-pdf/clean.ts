// Cleans a photo or scan of a handwritten signature: the paper becomes see-through, the ink solid,
// in the chosen colour and thickness, cropped to the ink. Pure pixel work, so it runs anywhere.

export type Filter = "original" | "clean" | "bold";

export interface CleanSettings {
  // Original keeps the picture as it is; Clean and Bold remove the paper.
  filter: Filter;
  // 0 to 100: how much of the paper's greys and shadows becomes see-through.
  removal: number;
  // 0 to 100: how strongly faint ink is darkened into solid ink.
  contrast: number;
  // Extra pixels added around each stroke, 0 to 3 steps.
  thickness: 0 | 1 | 2 | 3;
  // The pen's own colour, or a colour as #rrggbb.
  ink: "original" | `#${string}`;
  // Clockwise.
  turn: 0 | 90 | 180 | 270;
}

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Each filter's starting point for the sliders.
export const FILTERS: Record<Filter, Pick<CleanSettings, "removal" | "contrast" | "thickness">> = {
  original: { removal: 0, contrast: 0, thickness: 0 },
  clean: { removal: 50, contrast: 50, thickness: 0 },
  bold: { removal: 60, contrast: 80, thickness: 1 },
};

export const DEFAULT_CLEAN: CleanSettings = { filter: "clean", ...FILTERS.clean, ink: "original", turn: 0 };

// Less difference than this between paper and ink means there's no writing to find.
const MIN_INK_CONTRAST = 24;
// A pixel this see-through or more counts as empty when cropping.
const CROP_ALPHA = 8;

export function readClean(text: string): CleanSettings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // Nothing chosen yet.
  }
  const d = DEFAULT_CLEAN;
  const percent = (value: unknown, fallback: number) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Math.min(100, Math.max(0, Math.round(Number(value)))) : fallback);
  const filter = (["original", "clean", "bold"] as const).find((name) => name === raw.filter) ?? d.filter;
  const thickness = Number.isFinite(Number(raw.thickness)) ? Math.min(3, Math.max(0, Math.round(Number(raw.thickness)))) : d.thickness;
  const turn = [0, 90, 180, 270].includes(Number(raw.turn)) ? (Number(raw.turn) as CleanSettings["turn"]) : d.turn;
  const ink = typeof raw.ink === "string" && /^#[0-9a-f]{6}$/i.test(raw.ink) ? (raw.ink.toLowerCase() as `#${string}`) : "original";
  return {
    filter,
    removal: percent(raw.removal, d.removal),
    contrast: percent(raw.contrast, d.contrast),
    thickness: thickness as CleanSettings["thickness"],
    ink,
    turn,
  };
}

// How bright each pixel looks; see-through pixels count as white paper.
export function brightness({ data, width, height }: Pixels): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let pixel = 0; pixel < out.length; pixel++) {
    const at = pixel * 4;
    out[pixel] = data[at + 3] < 128 ? 255 : Math.round(0.299 * data[at] + 0.587 * data[at + 1] + 0.114 * data[at + 2]);
  }
  return out;
}

function percentile(levels: ArrayLike<number>, share: number): number {
  const counts = new Uint32Array(256);
  for (let index = 0; index < levels.length; index++) counts[levels[index]]++;
  const target = levels.length * share;
  let seen = 0;
  for (let level = 0; level < 256; level++) {
    seen += counts[level];
    if (seen >= target) return level;
  }
  return 255;
}

// How bright the paper is around each pixel. Light varies across a photo (shadows, a lamp on one side),
// so each pixel is compared with the paper near it, not with one level for the whole picture.
export function paperLevels({ width, height }: Pixels, levels: Uint8Array): Uint8Array {
  const block = Math.max(8, Math.round(Math.max(width, height) / 24));
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  // The bright end of each block is its paper; ink only darkens a few pixels.
  const grid = new Float32Array(columns * rows);
  const sample: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      sample.length = 0;
      for (let y = row * block; y < Math.min(height, (row + 1) * block); y++) {
        for (let x = column * block; x < Math.min(width, (column + 1) * block); x++) sample.push(levels[y * width + x]);
      }
      grid[row * columns + column] = percentile(sample, 0.9);
    }
  }
  // A block filled with ink takes the paper of its neighbours.
  const paper = new Float32Array(grid.length);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const r = row + dy;
          const c = column + dx;
          if (r >= 0 && c >= 0 && r < rows && c < columns) best = Math.max(best, grid[r * columns + c]);
        }
      }
      paper[row * columns + column] = best;
    }
  }
  // Smoothly between block centres, so there are no visible block edges.
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const r0 = Math.floor(gy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fy = gy - r0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(columns - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const c0 = Math.floor(gx);
      const c1 = Math.min(columns - 1, c0 + 1);
      const fx = gx - c0;
      const top = paper[r0 * columns + c0] * (1 - fx) + paper[r0 * columns + c1] * fx;
      const bottom = paper[r1 * columns + c0] * (1 - fx) + paper[r1 * columns + c1] * fx;
      out[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return out;
}

// Grows the ink by `radius` pixels each way. Each new pixel takes the colour of the ink it grew from.
function thicken(image: Pixels, radius: number): Pixels {
  const { width, height } = image;
  const pass = (source: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let best = (y * width + x) * 4;
        for (let step = -radius; step <= radius; step++) {
          const nx = horizontal ? x + step : x;
          const ny = horizontal ? y : y + step;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const at = (ny * width + nx) * 4;
          if (source[at + 3] > source[best + 3]) best = at;
        }
        out.set(source.subarray(best, best + 4), (y * width + x) * 4);
      }
    }
    return out;
  };
  return { width, height, data: pass(pass(image.data, true), false) };
}

// Cuts away the see-through edges, keeping a small margin around the ink.
export function cropToInk(image: Pixels): Pixels | null {
  const { data, width, height } = image;
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= CROP_ALPHA) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  // A small margin, so strokes don't touch the edge.
  const pad = Math.round(Math.max(right - left, bottom - top) * 0.03) + 2;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const out: Pixels = { width: right - left + 1, height: bottom - top + 1, data: new Uint8ClampedArray((right - left + 1) * (bottom - top + 1) * 4) };
  for (let y = top; y <= bottom; y++) {
    out.data.set(data.subarray((y * width + left) * 4, (y * width + right + 1) * 4), (y - top) * out.width * 4);
  }
  return out;
}

function rotate(image: Pixels, turn: CleanSettings["turn"]): Pixels {
  if (turn === 0) return image;
  const { data, width, height } = image;
  const sideways = turn !== 180;
  const out: Pixels = { width: sideways ? height : width, height: sideways ? width : height, data: new Uint8ClampedArray(data.length) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [nx, ny] = turn === 90 ? [height - 1 - y, x] : turn === 180 ? [width - 1 - x, height - 1 - y] : [y, width - 1 - x];
      out.data.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (ny * out.width + nx) * 4);
    }
  }
  return out;
}

// Null when there's no ink to find, like a photo of blank paper.
export function cleanSignature(source: Pixels, settings: CleanSettings): Pixels | null {
  if (settings.filter === "original") return rotate({ ...source, data: new Uint8ClampedArray(source.data) }, settings.turn);
  const levels = brightness(source);
  const paper = paperLevels(source, levels);
  // How much darker than its paper each pixel is. The strongest ink sets the scale.
  const depth = new Uint8Array(levels.length);
  for (let pixel = 0; pixel < levels.length; pixel++) depth[pixel] = Math.max(0, paper[pixel] - levels[pixel]);
  const ink = percentile(depth, 0.998);
  if (ink < MIN_INK_CONTRAST) return null;
  const cut = (settings.removal / 100) * 0.5;
  const steep = 1 + (settings.contrast / 100) * 4;
  const colour = settings.ink === "original" ? null : [1, 3, 5].map((at) => Number.parseInt(settings.ink.slice(at, at + 2), 16));
  const out: Pixels = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data.length) };
  for (let pixel = 0; pixel < levels.length; pixel++) {
    // 0 for paper, 1 for the darkest ink.
    const inkiness = Math.min(1, depth[pixel] / ink);
    let alpha = inkiness <= cut ? 0 : (inkiness - cut) / (1 - cut);
    alpha = Math.min(1, Math.max(0, (alpha - 0.5) * steep + 0.5));
    const at = pixel * 4;
    if (colour) out.data.set(colour, at);
    else out.data.set(source.data.subarray(at, at + 3), at);
    out.data[at + 3] = Math.round(alpha * 255);
  }
  const radius = settings.thickness * Math.max(1, Math.round(Math.max(source.width, source.height) / 500));
  const cropped = cropToInk(radius ? thicken(out, radius) : out);
  return cropped && rotate(cropped, settings.turn);
}
