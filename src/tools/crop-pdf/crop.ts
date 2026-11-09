import { PDFDocument } from "pdf-lib";
import { fromScreen, isFullPage, type CropRect } from "../../lib/shell/crop";
import { JobError } from "../../lib/worker/host";
import { MIN_SIDE } from "./box";

// What to cut, as boxes on pages as shown: one box for every page, or a box for each chosen page.
export interface CropPlan {
  all: CropRect | null;
  pages: { page: number; box: CropRect }[];
}

export class CropError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

function readBox(value: unknown): CropRect | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height].map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const left = Math.min(Math.max(numbers[0], 0), 1 - MIN_SIDE);
  const top = Math.min(Math.max(numbers[1], 0), 1 - MIN_SIDE);
  return { x: left, y: top, width: Math.min(Math.max(numbers[2], MIN_SIDE), 1 - left), height: Math.min(Math.max(numbers[3], MIN_SIDE), 1 - top) };
}

export function readPlan(text: string): CropPlan {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") raw = parsed as Record<string, unknown>;
  } catch {
    // Nothing chosen yet.
  }
  const all = readBox(raw.all);
  const pages = (Array.isArray(raw.pages) ? raw.pages : []).flatMap((item) => {
    const page = (item as Record<string, unknown>)?.page;
    const box = readBox((item as Record<string, unknown>)?.box);
    return Number.isInteger(page) && (page as number) >= 1 && box ? [{ page: page as number, box }] : [];
  });
  return { all: all && !isFullPage(all) ? all : null, pages: all ? [] : pages.filter(({ box }) => !isFullPage(box)) };
}

export function hasCrop(plan: CropPlan): boolean {
  return Boolean(plan.all) || plan.pages.length > 0;
}

// Cuts each page down to its box. All the page boxes are set, so viewers and printers agree on the new size.
export async function cropPdf(bytes: Uint8Array, plan: CropPlan): Promise<Uint8Array> {
  if (!hasCrop(plan)) throw new CropError("empty");
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new CropError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const boxes = new Map(plan.pages.map(({ page, box }) => [page, box]));
  doc.getPages().forEach((page, index) => {
    const shown = plan.all ?? boxes.get(index + 1);
    if (!shown) return;
    const crop = fromScreen(shown, page.getRotation().angle);
    const box = page.getCropBox();
    // A hundredth of a point is far finer than anyone can see, and keeps the numbers tidy.
    const round = (value: number) => Math.round(value * 100) / 100;
    const x = round(box.x + crop.x * box.width);
    const y = round(box.y + (1 - crop.y - crop.height) * box.height);
    const width = round(crop.width * box.width);
    const height = round(crop.height * box.height);
    page.setMediaBox(x, y, width, height);
    page.setCropBox(x, y, width, height);
    page.setTrimBox(x, y, width, height);
    page.setBleedBox(x, y, width, height);
    page.setArtBox(x, y, width, height);
  });
  return doc.save();
}

// Like most PDF tools: "report.pdf" becomes "report_cropped.pdf".
export function croppedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_cropped.pdf`;
}
