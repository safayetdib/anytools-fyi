import type { WatermarkImage } from "./watermark";

// The image chosen in the options panel, kept here so the run can use it. It's a file, so it can't travel in the form's text fields.
let chosen: (WatermarkImage & { width: number; height: number; url: string }) | null = null;

export function chosenImage() {
  return chosen;
}

export function setChosenImage(next: typeof chosen) {
  if (chosen) URL.revokeObjectURL(chosen.url);
  chosen = next;
}

// Turns any picture the browser can open into PNG, keeping see-through parts, ready to place in a PDF.
export async function prepareWatermarkImage(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    (canvas.getContext("2d") as CanvasRenderingContext2D).drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("Encode failed"))), "image/png"));
    canvas.width = canvas.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: "png" as const, width: bitmap.width, height: bitmap.height, url: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}
