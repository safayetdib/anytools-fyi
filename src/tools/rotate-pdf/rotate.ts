import { PDFDocument, degrees } from "pdf-lib";
import { JobError } from "../../lib/worker/host";

export class RotateError extends JobError {
  constructor(code: "encrypted" | "unreadable") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

// An angle plus a turn, as one of 0, 90, 180 or 270. Negative turns go anticlockwise.
export function quarterTurns(angle: number, turn: number): number {
  return (((Math.round((angle + turn) / 90) * 90) % 360) + 360) % 360;
}

// Like most PDF tools: "report.pdf" becomes "report_rotated.pdf".
export function rotatedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_rotated.pdf`;
}

// Turns every page by the same amount, on top of each page's own rotation.
export async function rotatePdf(bytes: Uint8Array, turn: number): Promise<{ bytes: Uint8Array; pageCount: number }> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new RotateError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  for (const page of document.getPages()) page.setRotation(degrees(quarterTurns(page.getRotation().angle, turn)));
  return { bytes: await document.save(), pageCount: document.getPageCount() };
}
