import type { Encode } from "./compress";

// Draws the picture at its new size on a canvas inside the worker and saves it as a JPEG.
// Without OffscreenCanvas (older browsers) pictures are left as they are; the rest of the savings still apply.
export const encodeJpeg: Encode = async (source, from, to, quality) => {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    const input = source.kind === "jpeg" ? new Blob([source.bytes as BlobPart], { type: "image/jpeg" }) : new ImageData(source.rgba as Uint8ClampedArray<ArrayBuffer>, from.width, from.height);
    // Decoding straight to the new size saves memory where the browser supports it; drawing below scales either way.
    bitmap = await createImageBitmap(input, { resizeWidth: to.width, resizeHeight: to.height, resizeQuality: "high" });
    const canvas = new OffscreenCanvas(to.width, to.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, to.width, to.height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
};
