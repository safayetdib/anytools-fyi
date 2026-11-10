import type { PdfDocument } from "../../lib/pdf/preview";
import type { RedactBox, RedactedPage } from "./redact";

// Runs in the page: drawing needs a canvas. pdf.js reads the PDF in its own worker.

type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

// Marked pages are redrawn at 200 dpi, sharp for reading and printing, with no side over this many pixels.
const DPI = 200;
const MAX_SIDE = 3500;
// Boxes found by searching reach a little past the letters, so no edge of them shows.
const PAD = 0.15;

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))), type, quality));

// The page as shown, with its boxes painted solid black, as a picture: PNG for pages of text, which it keeps sharp
// and small, JPG when the page is mostly photo and that's smaller.
export async function paintPage(page: PdfPage, boxes: RedactBox[]): Promise<RedactedPage> {
  const shown = page.getViewport({ scale: 1 });
  const scale = Math.min(DPI / 72, MAX_SIDE / Math.max(shown.width, shown.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  try {
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    context.fillStyle = "#000000";
    for (const box of boxes) {
      // Whole pixels outward, so no sliver of a letter is left at a box's edge.
      const left = Math.floor(box.x * canvas.width);
      const top = Math.floor(box.y * canvas.height);
      context.fillRect(left, top, Math.ceil((box.x + box.width) * canvas.width) - left, Math.ceil((box.y + box.height) * canvas.height) - top);
    }
    const [png, jpg] = await Promise.all([encode(canvas, "image/png"), encode(canvas, "image/jpeg", 0.9)]);
    const smaller = png.size <= jpg.size * 1.2 ? { blob: png, kind: "png" as const } : { blob: jpg, kind: "jpg" as const };
    return { page: page.pageNumber, bytes: new Uint8Array(await smaller.blob.arrayBuffer()), kind: smaller.kind, width: shown.width, height: shown.height };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

interface TextPiece {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Boxes over every place a word or phrase appears, ignoring case, on the pages as shown. Only straight, left-to-right
// text is found; text split across pieces of the PDF may be missed and can be marked by hand.
export async function findText(doc: PdfDocument, query: string): Promise<RedactBox[]> {
  const wanted = query.trim().toLocaleLowerCase();
  if (!wanted) return [];
  const boxes: RedactBox[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      for (const item of items as TextPiece[]) {
        if (typeof item.str !== "string" || !item.str) continue;
        const [a, b, c, d, x, y] = item.transform;
        // Only text that isn't slanted or turned within the page.
        if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0 || d <= 0) continue;
        const text = item.str.toLocaleLowerCase();
        const size = item.height || d;
        for (let at = text.indexOf(wanted); at !== -1; at = text.indexOf(wanted, at + wanted.length)) {
          const start = x + (at / text.length) * item.width - size * PAD;
          const end = x + ((at + wanted.length) / text.length) * item.width + size * PAD;
          const [left, top] = viewport.convertToViewportPoint(start, y + size * (0.85 + PAD));
          const [right, bottom] = viewport.convertToViewportPoint(end, y - size * (0.25 + PAD));
          const box = {
            page: number,
            x: Math.max(0, Math.min(left, right) / viewport.width),
            y: Math.max(0, Math.min(top, bottom) / viewport.height),
            width: Math.abs(right - left) / viewport.width,
            height: Math.abs(bottom - top) / viewport.height,
          };
          boxes.push({ ...box, width: Math.min(box.width, 1 - box.x), height: Math.min(box.height, 1 - box.y) });
        }
      }
    } finally {
      page.cleanup();
    }
  }
  return boxes;
}
