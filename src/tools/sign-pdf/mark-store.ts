import type { Pixels } from "./clean";
import type { Mark } from "./marks";

// The current picture of each mark, shared by its editor (which makes it), the pages (which show it) and the run (which signs with it).
// They're pictures, so they can't travel in the form's text fields.

export interface MarkPicture {
  // A PNG of the preview, for the pages.
  url: string;
  // Width divided by height, so placed copies keep its shape.
  ratio: number;
  // The same picture at full size for the PDF, or null when there's nothing to sign with.
  full: () => Promise<Pixels | null>;
}

const pictures = new Map<Mark, MarkPicture>();
const listeners = new Set<(mark: Mark) => void>();

export function pictureOf(mark: Mark): MarkPicture | null {
  return pictures.get(mark) ?? null;
}

// Null clears the mark, like an empty drawing pad.
export function publish(mark: Mark, picture: MarkPicture | null) {
  const old = pictures.get(mark);
  if (picture) pictures.set(mark, picture);
  else pictures.delete(mark);
  for (const listener of listeners) listener(mark);
  // Every copy shows the new picture by now, so the old one can go.
  if (old && old.url !== picture?.url) URL.revokeObjectURL(old.url);
}

export function onPicture(listener: (mark: Mark) => void) {
  listeners.add(listener);
}
