import { lightness, type GrayJpeg } from "./gray";

// High enough that photos and scans stay clean in grey.
const QUALITY = 0.9;

// Decodes the JPEG on a canvas inside the worker, turns each pixel grey and saves it as a JPEG again.
// Without OffscreenCanvas (older browsers) pictures are left in colour; the rest of the page still turns grey.
export const grayJpeg: GrayJpeg = async (jpeg) => {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const data = pixels.data;
    for (let at = 0; at < data.length; at += 4) {
      const level = Math.round(lightness(data[at], data[at + 1], data[at + 2]));
      data[at] = data[at + 1] = data[at + 2] = level;
    }
    context.putImageData(pixels, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};
