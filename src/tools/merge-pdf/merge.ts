import { PDFDocument } from "pdf-lib";
import { JobError } from "../../lib/worker/host";

export interface MergeInput {
  name: string;
  bytes: Uint8Array;
}

export class MergeError extends JobError {
  constructor(code: "encrypted" | "unreadable", fileName: string) {
    super(code, fileName);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

export async function mergePdfs(
  files: MergeInput[],
  onProgress: (fraction: number) => void,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const merged = await PDFDocument.create();
  // Saving the merged file is the last step, so reading the inputs fills the bar up to this share.
  const steps = files.length + 1;
  for (const [index, file] of files.entries()) {
    let source: PDFDocument;
    try {
      source = await PDFDocument.load(file.bytes, { updateMetadata: false });
    } catch (error) {
      throw new MergeError(isEncrypted(error) ? "encrypted" : "unreadable", file.name);
    }
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
    onProgress((index + 1) / steps);
  }
  const bytes = await merged.save();
  onProgress(1);
  return { bytes, pageCount: merged.getPageCount() };
}
