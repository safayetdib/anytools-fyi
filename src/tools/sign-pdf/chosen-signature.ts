import { decode } from "../jpg-to-pdf/images";
import { cleanSignature, type CleanSettings, type Pixels } from "./clean";

// The signature picture chosen in the panel, kept here so the run can use it. It's a file, so it can't travel in the form's text fields.

// Plenty for a signature printed at any size, and quick to clean.
const FULL_SIDE = 1600;
// The live preview is cleaned at this size, so sliders respond at once.
const PREVIEW_SIDE = 480;

let chosen: { full: Pixels; preview: Pixels } | null = null;

export function chosenSignature() {
  return chosen;
}

function pixelsOf(bitmap: ImageBitmap, longest: number): Pixels {
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  canvas.width = canvas.height = 0;
  return { data, width, height };
}

// Opens any picture the browser can (and iPhone HEIC photos), upright, at the two working sizes.
export async function chooseSignature(file: File) {
  const bitmap = await decode(file);
  try {
    chosen = { full: pixelsOf(bitmap, FULL_SIDE), preview: pixelsOf(bitmap, PREVIEW_SIDE) };
  } finally {
    bitmap.close();
  }
}

export function toPng(image: Pixels): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  (canvas.getContext("2d") as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("Encode failed"));
    }, "image/png"),
  );
}

// The cleaned signature at preview or full size, or null when no ink could be found.
export function cleaned(settings: CleanSettings, size: "preview" | "full"): Pixels | null {
  return chosen ? cleanSignature(chosen[size], settings) : null;
}
