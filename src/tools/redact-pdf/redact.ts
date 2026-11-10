import { PDFDocument } from "pdf-lib";
import { JobError } from "../../lib/worker/host";

// A box to black out, on the page as shown, from its top-left corner, as fractions of its width and height.
export interface RedactBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// A page with its boxes blacked out, drawn as a picture in the page, and its size as shown in points.
export interface RedactedPage {
  page: number;
  bytes: Uint8Array;
  kind: "jpg" | "png";
  width: number;
  height: number;
}

export class RedactError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty") {
    super(code);
  }
}

// Smaller than this, a box can't hide a letter.
const MIN_SIDE = 0.002;

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

export function readBoxes(text: string): RedactBox[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(text);
  } catch {
    // Nothing marked yet.
  }
  if (!Array.isArray(raw)) return [];
  const share = (value: number) => Math.min(1, Math.max(0, value));
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { page, x, y, width, height } = item as Record<string, unknown>;
    const numbers = [x, y, width, height].map(Number);
    if (!Number.isInteger(page) || (page as number) < 1 || [x, y, width, height].some((value) => value === null) || !numbers.every(Number.isFinite)) return [];
    const left = share(numbers[0]);
    const top = share(numbers[1]);
    const box = { page: page as number, x: left, y: top, width: Math.min(share(numbers[2]), 1 - left), height: Math.min(share(numbers[3]), 1 - top) };
    return box.width >= MIN_SIDE && box.height >= MIN_SIDE ? [box] : [];
  });
}

// The pages that have something to black out, in order.
export function pagesToRedact(boxes: RedactBox[]): number[] {
  return [...new Set(boxes.map((box) => box.page))].sort((a, b) => a - b);
}

// Builds a new PDF: pages with nothing marked are copied as they are; marked pages are replaced by their blacked-out
// pictures, so nothing under a box (text, pictures, links) is left in the file. A new file is built rather than pages
// swapped, because the old pages' contents would otherwise stay inside it. The document's details (title, author and
// the like) aren't carried over either.
export async function redactPdf(bytes: Uint8Array, pages: RedactedPage[]): Promise<Uint8Array> {
  if (!pages.length) throw new RedactError("empty");
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new RedactError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const output = await PDFDocument.create({ updateMetadata: false });
  const replaced = new Map(pages.map((page) => [page.page, page]));
  const kept = source.getPageIndices().filter((index) => !replaced.has(index + 1));
  const copies = new Map((await output.copyPages(source, kept)).map((copy, at) => [kept[at], copy]));
  for (const index of source.getPageIndices()) {
    const picture = replaced.get(index + 1);
    if (!picture) {
      output.addPage(copies.get(index));
      continue;
    }
    const image = picture.kind === "png" ? await output.embedPng(picture.bytes) : await output.embedJpg(picture.bytes);
    output.addPage([picture.width, picture.height]).drawImage(image, { x: 0, y: 0, width: picture.width, height: picture.height });
  }
  return output.save();
}

// Like most PDF tools: "contract.pdf" becomes "contract_redacted.pdf".
export function redactedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_redacted.pdf`;
}
