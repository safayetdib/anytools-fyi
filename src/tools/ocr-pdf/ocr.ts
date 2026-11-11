import { PDFDocument, degrees } from "pdf-lib";
import { shownSize, toPage } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";

// The languages the reader knows, by their Tesseract codes, in the order the panel shows them.
export const LANGUAGES = ["eng", "ben"] as const;
export type Language = (typeof LANGUAGES)[number];

// Reading a page takes a few seconds, so very long files are split first, as other OCR tools ask.
export const MAX_PAGES = 200;

// A page with at least this many letters, vowel signs and digits already has text, so it's left as it is rather than
// read twice. Fewer may be just a page number or a stamp on a scan.
const MIN_TEXT = 20;

export class OcrError extends JobError {
  constructor(code: "encrypted" | "unreadable", detail?: string) {
    super(code, detail);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

// Reads the panel's choice, such as "eng+ben". Nothing valid means English, the language most documents use.
export function readLanguages(text: string): Language[] {
  const chosen = LANGUAGES.filter((language) => text.split("+").includes(language));
  return chosen.length ? chosen : ["eng"];
}

export function hasText(text: string): boolean {
  return (text.match(/[\p{L}\p{M}\p{N}]/gu)?.length ?? 0) >= MIN_TEXT;
}

// Lays each page's recognised text over the page, invisible but there to search, select and copy. `layer` is a
// one-page PDF of that text, made at the page's shape as shown. The page itself, its pictures and size don't change.
export async function addTextLayers(bytes: Uint8Array, layers: { page: number; layer: Uint8Array }[]): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new OcrError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  for (const { page: number, layer } of layers) {
    if (number < 1 || number > document.getPageCount()) continue;
    const page = document.getPage(number - 1);
    const [text] = await document.embedPdf(layer);
    const [width, height] = shownSize(page);
    // From the bottom-left corner as shown, turned with the page so the text lines up with what's on it.
    const at = toPage(page, 0, 0);
    page.drawPage(text, { x: at.x, y: at.y, width, height, rotate: degrees(at.angle) });
  }
  return document.save();
}

// Like most PDF tools: "scan.pdf" becomes "scan_ocr.pdf".
export function ocrName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_ocr.pdf`;
}
