import { PDFDocument } from "pdf-lib";
import { IN, OUT, PACKED, type Qpdf } from "../../lib/pdf/qpdf";
import { JobError } from "../../lib/worker/host";

export class RepairError extends JobError {
  constructor(code: "locked" | "unreadable") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
const isEncrypted = (error: unknown) => /is encrypted/i.test(String((error as Error)?.message));

// A healthy file passes through qpdf, which writes a clean, tidy copy. A damaged one is rebuilt by pdf-lib, which
// finds each part of the file by reading it from start to end instead of trusting its broken table of contents.
// `fixed` says whether anything needed repairing.
export async function repairPdf(qpdf: Qpdf, bytes: Uint8Array): Promise<{ bytes: Uint8Array; fixed: boolean }> {
  const clean = await qpdf([PACKED, IN, OUT], bytes);
  if (clean.output) return { bytes: clean.output, fixed: clean.code === 3 };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { throwOnInvalidObject: false, updateMetadata: false });
  } catch (error) {
    throw new RepairError(isEncrypted(error) ? "locked" : "unreadable");
  }
  if (doc.getPageCount() === 0) throw new RepairError("unreadable");
  return { bytes: await doc.save(), fixed: true };
}

// Like most PDF tools: "report.pdf" becomes "report_repaired.pdf".
export function repairedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_repaired.pdf`;
}
