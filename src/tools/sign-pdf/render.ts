import { cropToInk, type Pixels } from "./clean";
import { strokeBounds, type Stroke } from "./marks";

// Draws typed and handwritten marks onto a canvas and returns them as see-through pixels cropped to the ink.

// Big pictures cost memory without looking any sharper in print.
const MAX_SIDE = 2400;

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D };
}

function finish(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): Pixels | null {
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = { data, width: canvas.width, height: canvas.height };
  canvas.width = canvas.height = 0;
  return cropToInk(pixels);
}

// Smooth lines through the recorded points; a single tap leaves a dot.
export function traceStrokes(context: CanvasRenderingContext2D, strokes: Stroke[], pen: number, colour: string) {
  context.strokeStyle = context.fillStyle = colour;
  context.lineWidth = pen;
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const points of strokes) {
    if (!points.length) continue;
    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, pen / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index++) {
      const next = points[index + 1];
      context.quadraticCurveTo(points[index].x, points[index].y, (points[index].x + next.x) / 2, (points[index].y + next.y) / 2);
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
    context.stroke();
  }
}

// The drawing, redrawn so its longer side is `longest` pixels, pen and all.
export function renderStrokes(strokes: Stroke[], pen: number, colour: string, longest: number): Pixels | null {
  const bounds = strokeBounds(strokes, pen);
  if (!bounds) return null;
  // A single dot isn't blown up to fill the picture.
  const scale = Math.min(longest / Math.max(bounds.width, bounds.height), 8);
  const margin = pen * scale;
  const { canvas, context } = canvasOf(bounds.width * scale + margin * 2, bounds.height * scale + margin * 2);
  context.setTransform(scale, 0, 0, scale, margin - bounds.left * scale, margin - bounds.top * scale);
  traceStrokes(context, strokes, pen, colour);
  return finish(canvas, context);
}

// Typed text in the chosen font, about `size` pixels tall. The font is fetched first, so the picture never shows a stand-in font.
export async function renderText(text: string, family: string, colour: string, size: number): Promise<Pixels | null> {
  const value = text.trim();
  if (!value) return null;
  try {
    await document.fonts.load(`${size}px ${family}`, value);
  } catch {
    // The device's own fonts will do.
  }
  const measure = canvasOf(1, 1).context;
  measure.font = `${size}px ${family}`;
  const wide = measure.measureText(value);
  // Long names are drawn smaller rather than as a huge picture.
  const fitted = Math.min(size, (size * MAX_SIDE) / Math.max(1, wide.actualBoundingBoxLeft + wide.actualBoundingBoxRight + size));
  measure.font = `${fitted}px ${family}`;
  const metrics = measure.measureText(value);
  // Handwriting fonts often reach beyond their own measurements, so leave room all round and crop afterwards.
  const pad = fitted * 0.5;
  const { canvas, context } = canvasOf(
    metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + pad * 2,
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + pad * 2,
  );
  context.font = `${fitted}px ${family}`;
  context.fillStyle = colour;
  context.fillText(value, pad + metrics.actualBoundingBoxLeft, pad + metrics.actualBoundingBoxAscent);
  return finish(canvas, context);
}
