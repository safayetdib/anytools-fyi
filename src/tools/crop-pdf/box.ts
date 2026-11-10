import type { CropRect } from "../../lib/shell/crop";

// The crop box as fractions of the page as shown, from its top-left corner, and how it's moved and sized.

export type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

// Smaller than this and there's nothing left to read.
export const MIN_SIDE = 0.05;
export const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
export const MM_PER_POINT = 25.4 / 72;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// The box after dragging `handle` by dx, dy (fractions of the page). Edges stop at the page and before meeting.
export function dragBox(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.width), y: clamp(start.y + dy, 0, 1 - start.height) };
  }
  let { x, y, width, height } = start;
  if (handle.includes("w")) {
    x = clamp(start.x + dx, 0, right - MIN_SIDE);
    width = right - x;
  }
  if (handle.includes("e")) width = clamp(start.width + dx, MIN_SIDE, 1 - start.x);
  if (handle.includes("n")) {
    y = clamp(start.y + dy, 0, bottom - MIN_SIDE);
    height = bottom - y;
  }
  if (handle.includes("s")) height = clamp(start.height + dy, MIN_SIDE, 1 - start.y);
  return { x, y, width, height };
}

// Arrow keys move the box; with Shift they grow or shrink it from its bottom-right corner.
export function nudgeBox(box: CropRect, key: string, resize: boolean, step = 0.01): CropRect | null {
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = moves[key];
  if (!move) return null;
  return dragBox(box, resize ? "se" : "move", move[0], move[1]);
}

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// How much is cut from each side, in millimetres, on a page this many points across and down.
export function marginsOf(box: CropRect, width: number, height: number): Margins {
  const mm = (share: number, side: number) => Math.round(share * side * MM_PER_POINT * 10) / 10;
  return {
    top: mm(box.y, height),
    bottom: mm(1 - box.y - box.height, height),
    left: mm(box.x, width),
    right: mm(1 - box.x - box.width, width),
  };
}

// The box that cuts these margins (millimetres), kept on the page and at least MIN_SIDE across.
export function boxFromMargins(margins: Margins, width: number, height: number): CropRect {
  const share = (mm: number, side: number) => clamp((Number.isFinite(mm) ? mm : 0) / MM_PER_POINT / side, 0, 1 - MIN_SIDE);
  const left = share(margins.left, width);
  const top = share(margins.top, height);
  const right = Math.min(share(margins.right, width), 1 - MIN_SIDE - left);
  const bottom = Math.min(share(margins.bottom, height), 1 - MIN_SIDE - top);
  return { x: left, y: top, width: 1 - left - right, height: 1 - top - bottom };
}

// The part of a drawn page that isn't blank paper, with a little room around it. Null for an empty page.
export function inkBox(pixels: Uint8ClampedArray, width: number, height: number, pad = 0.01): CropRect | null {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      // Near white, or see-through, counts as paper.
      const paper = pixels[at + 3] < 16 || (pixels[at] > 245 && pixels[at + 1] > 245 && pixels[at + 2] > 245);
      if (paper) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const x = Math.max(0, left / width - pad);
  const y = Math.max(0, top / height - pad);
  const box = { x, y, width: Math.min(1, (right + 1) / width + pad) - x, height: Math.min(1, (bottom + 1) / height + pad) - y };
  // Tiny specks still leave a box big enough to handle.
  return { ...box, width: Math.max(box.width, Math.min(MIN_SIDE, 1 - x)), height: Math.max(box.height, Math.min(MIN_SIDE, 1 - y)) };
}
