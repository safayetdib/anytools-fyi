import { decode, uprightImage } from "../jpg-to-pdf/images";
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

// Any picture the browser can open (and iPhone HEIC photos), upright and ready to place in a PDF. JPG and PNG go in as
// they are, so a photo doesn't come out several times bigger as a PNG.
export async function prepareWatermarkImage(file: File) {
  const { bytes, kind } = await uprightImage(file);
  const bitmap = await decode(file);
  try {
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: kind === "png" ? "image/png" : "image/jpeg" }));
    return { bytes, kind, width: bitmap.width, height: bitmap.height, url };
  } finally {
    bitmap.close();
  }
}
