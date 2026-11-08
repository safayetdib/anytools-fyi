import { PDFDocument } from "pdf-lib";
import { parsePageList } from "../../lib/pdf/page-list";
import { JobError } from "../../lib/worker/host";

export class RemoveError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty" | "all") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

// Like most PDF tools: "report.pdf" becomes "report_removed.pdf".
export function removedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_removed.pdf`;
}

// Removes the pages in a typed list such as "2,5-8". The rest stay exactly as they were, with the file's own details.
export async function removePages(bytes: Uint8Array, pages: string): Promise<{ bytes: Uint8Array; pageCount: number; removed: number }> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new RemoveError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const total = document.getPageCount();
  const doomed = parsePageList(pages, total);
  if (!doomed.length) throw new RemoveError("empty");
  if (doomed.length === total) throw new RemoveError("all");
  // From the last page back, so earlier page numbers don't shift.
  for (const page of [...doomed].reverse()) document.removePage(page - 1);
  return { bytes: await document.save(), pageCount: total - doomed.length, removed: doomed.length };
}
