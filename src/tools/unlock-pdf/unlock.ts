import { IN, OUT, PACKED, isProtected, type Qpdf } from "../../lib/pdf/qpdf";
import { JobError } from "../../lib/worker/host";

export class UnlockError extends JobError {
  constructor(code: "password" | "needsPassword" | "notLocked" | "unreadable") {
    super(code);
  }
}

// Removes the password and every restriction, such as on printing or copying. A file that only restricts what can be
// done opens without a password; one that needs a password to open needs it here too.
export async function unlockPdf(qpdf: Qpdf, bytes: Uint8Array, password = ""): Promise<Uint8Array> {
  if (!(await isProtected(bytes))) {
    // Not protected, or not a PDF at all: qpdf tells them apart.
    const check = await qpdf(["--check", IN], bytes);
    throw new UnlockError(check.code === 0 || check.code === 3 ? "notLocked" : "unreadable");
  }
  const result = await qpdf([`--password=${password}`, "--decrypt", PACKED, IN, OUT], bytes);
  if (result.output) return result.output;
  throw new UnlockError(password ? "password" : "needsPassword");
}

// Like most PDF tools: "report.pdf" becomes "report_unlocked.pdf".
export function unlockedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_unlocked.pdf`;
}
