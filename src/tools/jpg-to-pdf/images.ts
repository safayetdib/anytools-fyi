import { isHeic, jpegOrientation, type PreparedImage } from "./layout";

// Runs in the page: decoding images needs the browser. JPG and PNG pass through untouched when they can.

function kindOf(bytes: Uint8Array): "jpg" | "png" | "other" {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return "other";
}

// The browser turns photos the way their camera tag says, so what's decoded is what people see.
// Only Safari opens iPhone HEIC photos itself; elsewhere a HEIC decoder (about 0.8 MB) loads the first time one is chosen.
async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (error) {
    if (!isHeic(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) throw error;
    const { heicTo } = await import("heic-to");
    return heicTo({ blob: file, type: "bitmap", options: { imageOrientation: "from-image" } });
  }
}

function canvasFor(bitmap: ImageBitmap, width = bitmap.width, height = bitmap.height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))), type, quality));

function hasSeeThrough(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return true;
  return false;
}

// A small picture of the image as it's shown, and its shown size, for the file list and the page cards.
export async function imageThumbnail(file: File, width: number): Promise<{ image: Blob; width: number; height: number }> {
  const bitmap = await decode(file);
  try {
    const scale = Math.min(1, width / bitmap.width);
    const { canvas } = canvasFor(bitmap, bitmap.width * scale, bitmap.height * scale);
    const image = await toBlob(canvas, "image/png");
    canvas.width = canvas.height = 0;
    return { image, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

// Ready to place in a PDF: JPG and PNG as they are, everything else (and turned photos) converted once.
export async function prepareImage(file: File, rotate: number): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindOf(bytes);
  if (kind === "png") return { bytes, kind, rotate };
  if (kind === "jpg" && jpegOrientation(bytes) === 1) return { bytes, kind, rotate };
  const bitmap = await decode(file);
  try {
    const { canvas, context } = canvasFor(bitmap);
    // Photos become JPG; images with see-through parts, like logos, stay PNG so they keep them.
    const png = kind === "other" && hasSeeThrough(context, canvas.width, canvas.height);
    const blob = await toBlob(canvas, png ? "image/png" : "image/jpeg", 0.92);
    canvas.width = canvas.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: png ? "png" : "jpg", rotate };
  } finally {
    bitmap.close();
  }
}
