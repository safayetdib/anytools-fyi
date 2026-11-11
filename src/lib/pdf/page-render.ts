import type { PdfDocument } from "./preview";

// Draws a page twice, with and without its text, for tools that put the text back as something editable: the page
// without text becomes a picture behind it, and comparing the two finds each piece of text's colour. Runs in the page.

type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

export interface PageLayers {
  scale: number;
  withText: HTMLCanvasElement;
  withoutText: HTMLCanvasElement;
}

// Pixels for the page's long side: sharp on a large screen, and small enough for a phone's memory.
const LONG_SIDE = 2000;
const MAX_SCALE = 2.5;

async function draw(page: PdfPage, scale: number, text: boolean): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const proto = CanvasRenderingContext2D.prototype;
  const { fillText, strokeText } = proto;
  // pdf.js draws letters with fillText and strokeText, so while they do nothing, everything but the text is drawn.
  if (!text) {
    proto.fillText = () => {};
    proto.strokeText = () => {};
  }
  try {
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
  } finally {
    proto.fillText = fillText;
    proto.strokeText = strokeText;
  }
  return canvas;
}

export async function renderLayers(page: PdfPage): Promise<PageLayers> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, LONG_SIDE / Math.max(base.width, base.height));
  const withText = await draw(page, scale, true);
  const withoutText = await draw(page, scale, false);
  return { scale, withText, withoutText };
}

export function releaseLayers(layers: PageLayers) {
  for (const canvas of [layers.withText, layers.withoutText]) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

// The colour of the text drawn in a box on the page, in points from its top-left corner, as "RRGGBB": the pixels the
// text changed, on average. Text that draws nothing, such as OCR's hidden text, comes back black.
export function textColour(layers: PageLayers, box: { x: number; y: number; width: number; height: number }): string {
  const { scale, withText, withoutText } = layers;
  const x = Math.max(0, Math.floor(box.x * scale));
  const y = Math.max(0, Math.floor(box.y * scale));
  const width = Math.min(withText.width - x, Math.ceil(box.width * scale));
  const height = Math.min(withText.height - y, Math.ceil(box.height * scale));
  if (width <= 0 || height <= 0) return "000000";
  const a = (withText.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(x, y, width, height).data;
  const b = (withoutText.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(x, y, width, height).data;
  let r = 0;
  let g = 0;
  let bl = 0;
  let weight = 0;
  for (let i = 0; i < a.length; i += 4) {
    const change = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    // Only the letters, not their soft edges blended with what's behind.
    if (change < 120) continue;
    // Pixels the text changed most count most: they're the letters' own colour, unblended.
    const strength = change ** 3;
    r += a[i] * strength;
    g += a[i + 1] * strength;
    bl += a[i + 2] * strength;
    weight += strength;
  }
  if (!weight) return "000000";
  // Near black and near white are almost always meant as black and white.
  const channels = [r, g, bl].map((value) => Math.round(value / weight));
  if (channels.every((value) => value < 24)) return "000000";
  if (channels.every((value) => value > 231)) return "FFFFFF";
  return channels.map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// For text hidden behind a scan: the paper's colour and the ink's colour in a box on the page, as "RRGGBB", from the
// lighter half of its pixels and the darkest tenth.
export function scanColours(layers: PageLayers, box: { x: number; y: number; width: number; height: number }): { paper: string; ink: string } {
  const { scale, withText } = layers;
  const x = Math.max(0, Math.floor(box.x * scale));
  const y = Math.max(0, Math.floor(box.y * scale));
  const width = Math.min(withText.width - x, Math.ceil(box.width * scale));
  const height = Math.min(withText.height - y, Math.ceil(box.height * scale));
  if (width <= 0 || height <= 0) return { paper: "FFFFFF", ink: "000000" };
  const data = (withText.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(x, y, width, height).data;
  const pixels: [number, number, number, number][] = [];
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114, data[i], data[i + 1], data[i + 2]]);
  pixels.sort((a, b) => a[0] - b[0]);
  const average = (from: number, to: number) => {
    const part = pixels.slice(Math.floor(from * pixels.length), Math.max(Math.floor(from * pixels.length) + 1, Math.floor(to * pixels.length)));
    return [1, 2, 3].map((channel) => Math.round(part.reduce((sum, pixel) => sum + pixel[channel], 0) / part.length).toString(16).padStart(2, "0")).join("").toUpperCase();
  };
  return { paper: average(0.5, 1), ink: average(0, 0.1) };
}

export const canvasToJpeg = (canvas: HTMLCanvasElement, quality = 0.85) =>
  new Promise<Uint8Array>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject) : reject(new Error("Encode failed"))), "image/jpeg", quality),
  );
