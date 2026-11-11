import type { EditImage } from "./edit";

// Pictures added in the panel, kept here so the run can use them. They're files, so they can't travel in the form's
// text fields; edits name them by their place in this list.
const images: (EditImage & { url: string; ratio: number })[] = [];

export function addImage(image: EditImage & { width: number; height: number }): number {
  const type = image.kind === "png" ? "image/png" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type }));
  images.push({ bytes: image.bytes, kind: image.kind, url, ratio: image.width / image.height });
  return images.length - 1;
}

export function imageAt(index: number) {
  return images[index];
}

export function allImages(): EditImage[] {
  return images.map(({ bytes, kind }) => ({ bytes, kind }));
}

export function clearImages() {
  images.splice(0).forEach((image) => URL.revokeObjectURL(image.url));
}
