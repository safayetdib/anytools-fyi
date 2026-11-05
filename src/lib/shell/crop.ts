// A crop as fractions of the page, measured from its top-left corner. Crops are stored against the page as it is
// before any turning, so rotating a page later keeps the same part of it.
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Point = [number, number];

// Where a point on the unturned page appears once the page is turned clockwise.
function turnPoint([x, y]: Point, turn: number): Point {
  switch (((turn % 360) + 360) % 360) {
    case 90:
      return [1 - y, x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [y, 1 - x];
    default:
      return [x, y];
  }
}

function boxAround(a: Point, b: Point): CropRect {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

// The crop as it appears on screen, on a page turned clockwise by `turn` degrees.
export function toScreen(crop: CropRect, turn: number): CropRect {
  return boxAround(turnPoint([crop.x, crop.y], turn), turnPoint([crop.x + crop.width, crop.y + crop.height], turn));
}

// The crop on the unturned page, from a box drawn on a page turned clockwise by `turn` degrees.
export function fromScreen(box: CropRect, turn: number): CropRect {
  const back = 360 - (((turn % 360) + 360) % 360);
  return boxAround(turnPoint([box.x, box.y], back), turnPoint([box.x + box.width, box.y + box.height], back));
}

// Crops this close to the edge keep the whole page, so they're treated as no crop at all.
const EDGE = 0.005;

export function isFullPage(crop: CropRect): boolean {
  return crop.x <= EDGE && crop.y <= EDGE && crop.x + crop.width >= 1 - EDGE && crop.y + crop.height >= 1 - EDGE;
}
