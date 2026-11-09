import { PDFDocument, degrees, type PDFImage } from "pdf-lib";
import { shownSize, toPage } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";
import { MARKS, type Mark } from "./marks";

// Where a mark goes: its top-left corner and width as fractions of the page as shown. Its height follows the picture.
export interface Placement {
  page: number;
  mark: Mark;
  x: number;
  y: number;
  width: number;
}

export interface SignatureImage {
  // A PNG, so see-through parts stay see-through.
  bytes: Uint8Array;
  width: number;
  height: number;
}

export class SignError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty") {
    super(code);
  }
}

// Narrower than this and a signature can't be read.
const MIN_WIDTH = 0.02;

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

export function readPlacements(text: string): Placement[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(text);
  } catch {
    // Nothing placed yet.
  }
  if (!Array.isArray(raw)) return [];
  const share = (value: unknown, min = 0) => Math.min(1, Math.max(min, Number(value)));
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { page, mark, x, y, width } = item as Record<string, unknown>;
    if (!Number.isInteger(page) || (page as number) < 1 || ![x, y, width].every((value) => Number.isFinite(Number(value)) && value !== null)) return [];
    // Placements made before there were other marks are signatures.
    const kind = MARKS.find((name) => name === mark) ?? "signature";
    return [{ page: page as number, mark: kind, x: share(x), y: share(y), width: share(width, MIN_WIDTH) }];
  });
}

// The signature's box in points on the page as shown, measured from the bottom-left like PDF coordinates.
// `ratio` is the picture's width divided by its height.
export function placedRect(pageWidth: number, pageHeight: number, place: Placement, ratio: number) {
  const width = place.width * pageWidth;
  const height = width / ratio;
  return { x: place.x * pageWidth, y: pageHeight - place.y * pageHeight - height, width, height };
}

// Each mark's picture is embedded once, however many pages it is placed on.
export async function signPdf(bytes: Uint8Array, images: Partial<Record<Mark, SignatureImage>>, placements: Placement[]): Promise<Uint8Array> {
  const drawable = placements.filter((place) => images[place.mark]);
  if (!drawable.length) throw new SignError("empty");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new SignError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const pictures = new Map<Mark, { picture: PDFImage; ratio: number }>();
  for (const place of drawable) {
    if (place.page > doc.getPageCount()) continue;
    const image = images[place.mark] as SignatureImage;
    let embedded = pictures.get(place.mark);
    if (!embedded) {
      embedded = { picture: await doc.embedPng(image.bytes), ratio: image.width / image.height };
      pictures.set(place.mark, embedded);
    }
    const { picture, ratio } = embedded;
    const page = doc.getPage(place.page - 1);
    const [width, height] = shownSize(page);
    const box = placedRect(width, height, place, ratio);
    // Drawn from its bottom-left corner as shown, turned with the page so it looks upright.
    const at = toPage(page, box.x, box.y);
    page.drawImage(picture, { x: at.x, y: at.y, width: box.width, height: box.height, rotate: degrees(at.angle) });
  }
  return doc.save();
}

// Like most PDF tools: "agreement.pdf" becomes "agreement_signed.pdf".
export function signedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_signed.pdf`;
}
