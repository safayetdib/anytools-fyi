import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream } from "pdf-lib";
import { dropUnreachable } from "../../lib/pdf/prune";
import { JobError } from "../../lib/worker/host";

// Takes out everything a PDF says about itself and where it came from: its title, author, subject and keywords, the
// apps that made it, its dates, the hidden XMP copy of all of that, apps' private notes, its file ID, and the camera
// and place details inside its photos. The pages stay exactly as they were.

export class MetadataError extends JobError {
  constructor(code: "encrypted" | "unreadable") {
    super(code);
  }
}

// What was found and removed, in the order a summary lists it.
export const DETAILS = ["title", "author", "subject", "keywords", "app", "dates", "custom", "xmp", "photos"] as const;
export type Detail = (typeof DETAILS)[number];

const INFO_KEYS: Record<string, Detail> = {
  Title: "title",
  Author: "author",
  Subject: "subject",
  Keywords: "keywords",
  Creator: "app",
  Producer: "app",
  CreationDate: "dates",
  ModDate: "dates",
};

// JPEG sections that carry details rather than the picture: Exif and XMP (APP1), others' notes (APP3 to APP13, APP15)
// and comments. The JFIF header (APP0), colour profile (APP2) and Adobe's colour note (APP14) are needed to show it.
const DROPPED_MARKERS = new Set([0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xef, 0xfe]);

// A JPEG with its detail sections taken out, or null when it has none or can't be read.
export function cleanJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  let dropped = false;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at++;
      continue;
    }
    // Start of the picture data: everything from here on is the picture.
    if (marker === 0xda) {
      kept.push(bytes.subarray(at));
      break;
    }
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (DROPPED_MARKERS.has(marker)) dropped = true;
    else kept.push(bytes.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  if (!dropped) return null;
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isJpeg(stream: PDFRawStream): boolean {
  const filter = stream.dict.get(PDFName.of("Filter"));
  if (filter instanceof PDFName) return filter.asString() === "/DCTDecode";
  return filter instanceof PDFArray && filter.size() === 1 && filter.get(0) instanceof PDFName && (filter.get(0) as PDFName).asString() === "/DCTDecode";
}

export async function removeMetadata(bytes: Uint8Array): Promise<{ bytes: Uint8Array; removed: Detail[] }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new MetadataError(/is encrypted/i.test(String((error as Error)?.message)) ? "encrypted" : "unreadable");
  }
  const { context } = doc;
  const removed = new Set<Detail>();
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const [key, value] of info.entries()) {
      // Empty entries say nothing.
      if (value.toString() === "()" || value.toString() === "<>") continue;
      removed.add(INFO_KEYS[key.decodeText()] ?? "custom");
    }
  }
  context.trailerInfo.Info = undefined;
  context.trailerInfo.ID = undefined;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object instanceof PDFStream ? object.dict : null;
    if (!dict) continue;
    if (dict.has(PDFName.of("Metadata"))) {
      dict.delete(PDFName.of("Metadata"));
      removed.add("xmp");
    }
    // Apps' private notes about how they made a page or the document.
    for (const key of ["PieceInfo", "LastModified"]) {
      if (dict.has(PDFName.of(key))) {
        dict.delete(PDFName.of(key));
        removed.add("custom");
      }
    }
    if (object instanceof PDFRawStream && isJpeg(object)) {
      const clean = cleanJpeg(object.contents);
      if (clean) {
        context.assign(ref as PDFRef, PDFRawStream.of(object.dict, clean));
        removed.add("photos");
      }
    }
  }
  await dropUnreachable(doc);
  return { bytes: await doc.save(), removed: DETAILS.filter((detail) => removed.has(detail)) };
}

// "report.pdf" becomes "report_clean.pdf".
export function cleanName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_clean.pdf`;
}
