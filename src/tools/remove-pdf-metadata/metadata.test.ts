import { readFile } from "node:fs/promises";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { MetadataError, cleanJpeg, cleanName, removeMetadata } from "./metadata";

const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description dc:creator="Rahim"/></rdf:RDF></x:xmpmeta>';

// A report with every kind of detail: the document's own, a hidden XMP copy, an app's notes, and a phone photo.
async function report(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Quarterly report");
  doc.setAuthor("Rahim Uddin");
  doc.setKeywords(["sales", "dhaka"]);
  doc.setCreator("Word");
  doc.setProducer("Acrobat");
  const page = doc.addPage([400, 400]);
  page.drawText("Sales went up.", { x: 50, y: 350, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  page.drawImage(await doc.embedJpg(await readFile("tests/fixtures/images/phone.jpg")), { x: 50, y: 50, width: 200, height: 150 });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(doc.context.stream(XMP, { Type: "Metadata", Subtype: "XML" })));
  page.node.set(PDFName.of("PieceInfo"), doc.context.obj({ Word: { Private: "notes" } }));
  return doc.save({ useObjectStreams: false });
}

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

describe("removeMetadata", () => {
  it("takes out every detail, leaving the pages as they were", async () => {
    const input = await report();
    expect(text(input)).toContain('dc:creator="Rahim"');
    const { bytes, removed } = await removeMetadata(input);
    expect(removed).toEqual(["title", "author", "keywords", "app", "dates", "custom", "xmp", "photos"]);
    const raw = text(bytes);
    for (const gone of ["Rahim", "Quarterly", "Acrobat", "Exif", "PieceInfo", "/Info", "/ID"]) expect(raw).not.toContain(gone);
    const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
    const { info, metadata } = (await doc.getMetadata()) as { info: Record<string, unknown>; metadata: unknown };
    expect(info.Title ?? null).toBeNull();
    expect(info.Author ?? null).toBeNull();
    expect(metadata).toBeNull();
    const page = await doc.getPage(1);
    expect((await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("")).toBe("Sales went up.");
    // The photo is still there, still a JPEG.
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    const photos = [...loaded.context.enumerateIndirectObjects()].filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Filter"))?.toString() === "/DCTDecode");
    expect(photos).toHaveLength(1);
    expect(loaded.getProducer()).toBeUndefined();
  });

  it("says when a PDF had nothing to take out", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    expect((await removeMetadata(await doc.save())).removed).toEqual([]);
    await expect(removeMetadata(await makeEncryptedPdf())).rejects.toBeInstanceOf(MetadataError);
    expect(cleanName("report.PDF")).toBe("report_clean.pdf");
  });
});

describe("cleanJpeg", () => {
  it("drops a photo's Exif section and keeps the picture", async () => {
    const photo = new Uint8Array(await readFile("tests/fixtures/images/phone.jpg"));
    const clean = cleanJpeg(photo) as Uint8Array;
    expect(clean.length).toBe(photo.length - 36);
    expect(text(clean)).not.toContain("Exif");
    expect(text(clean)).toContain("JFIF");
    expect(cleanJpeg(clean)).toBeNull();
    expect(cleanJpeg(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
