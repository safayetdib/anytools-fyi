import "@fontsource/noto-sans-bengali/400.css";
import "@fontsource/noto-sans-bengali/700.css";
import "@fontsource/noto-serif-bengali/400.css";
import "@fontsource/noto-serif-bengali/700.css";
import type { TextPicture } from "./stamp";

// Runs in the page: draws text that PDF's built-in fonts can't, such as Bangla, so it can go into a PDF as a picture.
// The browser joins Bangla letters correctly; pdf-lib can't. Latin letters keep a look close to the chosen font.

export interface TextStyle {
  font: "helvetica" | "times" | "courier";
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

const BANGLA = { helvetica: "Noto Sans Bengali", times: "Noto Serif Bengali", courier: "Noto Sans Bengali" } as const;
// Also used to preview the text on pages before it is drawn.
export const FAMILIES = {
  helvetica: `Helvetica, Arial, "${BANGLA.helvetica}", sans-serif`,
  times: `"Times New Roman", Times, "${BANGLA.times}", serif`,
  courier: `"Courier New", Courier, "${BANGLA.courier}", monospace`,
} as const;

// Pixels for each point: about 300 dpi, sharp in print.
const SCALE = 4;
// Phones refuse much larger canvases.
const MAX_SIDE = 8000;

function fontOf(style: TextStyle, pixels: number, family: string = FAMILIES[style.font]) {
  return `${style.italic ? "italic " : ""}${style.bold ? 700 : 400} ${pixels}px ${family}`;
}

export async function textPicture(text: string, style: TextStyle): Promise<TextPicture> {
  // Fonts load only when their letters are needed, so ask for them before drawing.
  await document.fonts.load(fontOf(style, 16, `"${BANGLA[style.font]}"`), text).catch(() => []);
  const measure = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  measure.font = fontOf(style, style.size);
  const metrics = measure.measureText(text);
  const width = metrics.width;
  // Bangla vowel signs reach above and below most Latin letters, so the taller of the two measures is used.
  const ascent = Math.max(metrics.fontBoundingBoxAscent || 0, metrics.actualBoundingBoxAscent || 0, style.size * 0.8) + style.size * 0.05;
  const descent = Math.max(metrics.fontBoundingBoxDescent || 0, metrics.actualBoundingBoxDescent || 0, style.size * 0.2) + style.size * 0.05;
  const pad = style.size * 0.25;
  const scale = Math.min(SCALE, MAX_SIDE / (width + pad * 2), MAX_SIDE / (ascent + descent));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((width + pad * 2) * scale));
  canvas.height = Math.max(1, Math.ceil((ascent + descent) * scale));
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.scale(scale, scale);
  context.font = fontOf(style, style.size);
  context.fillStyle = style.color;
  context.textBaseline = "alphabetic";
  context.fillText(text, pad, ascent);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("Draw failed"))), "image/png"));
  canvas.width = canvas.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, ascent, descent, pad };
}
