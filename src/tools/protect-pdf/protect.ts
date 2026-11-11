import { IN, OUT, PACKED, isProtected, type Qpdf } from "../../lib/pdf/qpdf";
import { JobError } from "../../lib/worker/host";
import { MAX_PASSWORD } from "./password";

export class ProtectError extends JobError {
  constructor(code: "locked" | "unreadable" | "password") {
    super(code);
  }
}

// AES-256, the strongest PDF encryption, which every current PDF reader opens. The same password opens the file and
// allows everything in it, like other tools.
export async function protectPdf(qpdf: Qpdf, bytes: Uint8Array, password: string): Promise<Uint8Array> {
  if (!password || password.length > MAX_PASSWORD) throw new ProtectError("password");
  const result = await qpdf([PACKED, "--encrypt", `--user-password=${password}`, `--owner-password=${password}`, "--bits=256", "--", IN, OUT], bytes);
  if (result.output) return result.output;
  // Did it fail because the file already needs a password to open?
  throw new ProtectError((await isProtected(bytes)) ? "locked" : "unreadable");
}

// Like most PDF tools: "report.pdf" becomes "report_protected.pdf".
export function protectedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_protected.pdf`;
}
