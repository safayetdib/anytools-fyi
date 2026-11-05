import { PDFDocument } from "pdf-lib";

// A PDF whose pages have the given widths, so tests can check page order.
export async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 300]);
  return doc.save({ useObjectStreams: false });
}

// pdf-lib refuses any file whose trailer names an Encrypt dictionary, as real protected PDFs do.
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const text = new TextDecoder("latin1").decode(await makePdf([100]));
  const marked = text.replace("trailer\n<<", "trailer\n<<\n/Encrypt 1 0 R");
  if (marked === text) throw new Error("Could not mark the test PDF as encrypted");
  return Uint8Array.from(marked, (char) => char.charCodeAt(0));
}

export async function pageWidths(bytes: Uint8Array | Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}
