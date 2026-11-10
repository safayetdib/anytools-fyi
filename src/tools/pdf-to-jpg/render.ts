import { loadPdfjs } from "../../lib/pdf/preview";
import type { OutputPreview, RenderedPage } from "../../lib/shell/types";
import { MAX_SIDE, QUALITY, pixelsToRgba, renderWidth, type Choice, type Format } from "./convert";

// Runs in the page: drawing needs a canvas. pdf.js reads the PDF in its own worker.

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;
type PdfDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

// Pictures smaller than this on a side are lines and dots, not photos.
const MIN_IMAGE_SIDE = 8;

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))), type, quality));
const toJpeg = (canvas: HTMLCanvasElement, quality: number) => encode(canvas, "image/jpeg", quality);
const toPicture = (canvas: HTMLCanvasElement, format: Format, quality: Choice["quality"]) =>
  format === "png" ? encode(canvas, "image/png") : toJpeg(canvas, QUALITY[quality].jpeg);

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

export class PdfLocked extends Error {}

export async function openPdf(file: File): Promise<{ doc: PdfDocument; close: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    throw (error as Error)?.name === "PasswordException" ? new PdfLocked() : error;
  }
}

// One page as a picture, turned the way the PDF shows it. JPG is always on white; PNG may keep the background see-through.
export async function pageToPicture(page: PdfPage, choice: Choice, format: Format): Promise<Blob> {
  const { quality } = choice;
  const clear = format === "png" && choice.background === "transparent";
  const base = page.getViewport({ scale: 1 });
  const width = renderWidth(base.width, base.height, quality);
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  try {
    // pdf.js asks for an opaque canvas; one made with see-through pixels first stays that way.
    if (clear) canvas.getContext("2d", { alpha: true });
    await page.render({ canvas, viewport, background: clear ? "rgba(0,0,0,0)" : "#ffffff" }).promise;
    return await toPicture(canvas, format, quality);
  } finally {
    release(canvas);
  }
}

interface PdfImage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray;
  kind?: number;
}

function imageObject(page: PdfPage, name: string): Promise<PdfImage | null> {
  // Pictures shared across pages live in commonObjs, named "g_…".
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      store.get(name, (value: unknown) => resolve((value as PdfImage) ?? null));
    } catch {
      resolve(null);
    }
  });
}

// A fingerprint of a saved picture, so the same photo used on several pages is saved once.
async function fingerprint(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Every picture placed on a page, once each, in the order they're drawn. `seen` carries across pages.
export async function pageImages(lib: Pdfjs, page: PdfPage, seen: Set<string>, quality: Choice["quality"], format: Format): Promise<Blob[]> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const blobs: Blob[] = [];
  const paints = new Set([lib.OPS.paintImageXObject, lib.OPS.paintImageXObjectRepeat]);
  for (const [index, fn] of fnArray.entries()) {
    if (!paints.has(fn)) continue;
    const name = argsArray[index]?.[0];
    if (typeof name !== "string" || seen.has(name)) continue;
    seen.add(name);
    const image = await imageObject(page, name);
    if (!image || image.width < MIN_IMAGE_SIDE || image.height < MIN_IMAGE_SIDE) continue;
    const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d") as CanvasRenderingContext2D;
    // JPG has no see-through parts, so they become white, like paper. PNG keeps them.
    if (format === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    try {
      if (image.bitmap) context.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
      else if (image.data) {
        const raw = document.createElement("canvas");
        raw.width = image.width;
        raw.height = image.height;
        const pixels = pixelsToRgba(image.data, image.width, image.height, image.kind ?? 3);
        (raw.getContext("2d") as CanvasRenderingContext2D).putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), 0, 0);
        context.drawImage(raw, 0, 0, canvas.width, canvas.height);
        release(raw);
      } else continue;
      const blob = await toPicture(canvas, format, quality);
      const print = await fingerprint(blob);
      if (seen.has(print)) continue;
      seen.add(print);
      blobs.push(blob);
    } finally {
      release(canvas);
    }
  }
  return blobs;
}

// Lets the result cards and the larger view show picture results, the way they show PDF pages.
export async function previewImage(blob: Blob): Promise<OutputPreview> {
  const bitmap = await createImageBitmap(blob);
  return {
    pageCount: 1,
    async renderPage(_page: number, width: number): Promise<RenderedPage> {
      const scale = Math.min(1, width / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      try {
        // A PNG preview keeps its see-through parts.
        const shown = blob.type === "image/png" ? await encode(canvas, "image/png") : await toJpeg(canvas, 0.85);
        return { blob: shown, width: canvas.width, height: canvas.height, turn: 0 };
      } finally {
        release(canvas);
      }
    },
    close: () => bitmap.close(),
  };
}
