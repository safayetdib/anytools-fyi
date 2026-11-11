import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { FlattenError, flattenPdf, flattenedName } from "./flatten";

// A page with a filled-in name field, a ticked box, a blue square comment with a pop-up note, and a link.
async function formWithComment(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const name = form.createTextField("name");
  name.addToPage(page, { x: 50, y: 300, width: 200, height: 24, font });
  name.setText("Rahim Uddin");
  const agree = form.createCheckBox("agree");
  agree.addToPage(page, { x: 50, y: 250, width: 16, height: 16 });
  agree.check();
  form.updateFieldAppearances(font);
  const look = doc.context.register(doc.context.stream("0 0 1 rg 0 0 50 50 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 50, 50] }));
  const square = doc.context.register(
    doc.context.obj({ Type: "Annot", Subtype: "Square", Rect: [100, 100, 150, 150], Contents: PDFString.of("secret note"), AP: { N: look } }),
  );
  const popup = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Popup", Rect: [200, 100, 300, 150], Parent: square }));
  const link = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [300, 300, 350, 320], A: { S: "URI", URI: PDFString.of("https://anytools.fyi") } }));
  page.node.Annots()?.push(square);
  page.node.Annots()?.push(popup);
  page.node.Annots()?.push(link);
  return doc.save();
}

async function read(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
  const annotations = (await page.getAnnotations()).map((annotation) => annotation.subtype);
  return { text, annotations };
}

// Every string left in the file, wherever it is.
async function strings(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const found: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFDict) for (const [, value] of object.entries()) if (value instanceof PDFString) found.push(value.decodeText());
  }
  return found;
}

describe("flattenPdf", () => {
  it("draws fields and comments into the page and takes them away, keeping links", async () => {
    const result = await flattenPdf(await formWithComment(), { forms: true, marks: true });
    expect(result).toMatchObject({ fields: 2, marks: 1 });
    const { text, annotations } = await read(result.bytes);
    expect(text).toContain("Rahim Uddin");
    expect(annotations).toEqual(["Link"]);
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.catalog.has(PDFName.of("AcroForm"))).toBe(false);
    // The comment's note is gone from the file, not just from the page.
    expect(await strings(result.bytes)).not.toContain("secret note");
  });

  it("can flatten only the form, or only the comments", async () => {
    const formOnly = await flattenPdf(await formWithComment(), { forms: true, marks: false });
    expect(formOnly).toMatchObject({ fields: 2, marks: 0 });
    expect((await read(formOnly.bytes)).annotations.sort()).toEqual(["Link", "Popup", "Square"]);
    const marksOnly = await flattenPdf(await formWithComment(), { forms: false, marks: true });
    expect(marksOnly).toMatchObject({ fields: 0, marks: 1 });
    expect((await read(marksOnly.bytes)).annotations.sort()).toEqual(["Link", "Widget", "Widget"]);
    expect((await PDFDocument.load(marksOnly.bytes)).getForm().getFields()).toHaveLength(2);
  });

  it("says when there's nothing to flatten, or the file is locked", async () => {
    const plain = await PDFDocument.create();
    plain.addPage();
    await expect(flattenPdf(await plain.save(), { forms: true, marks: true })).rejects.toMatchObject({ code: "nothing" });
    await expect(flattenPdf(await makeEncryptedPdf(), { forms: true, marks: true })).rejects.toBeInstanceOf(FlattenError);
    expect(flattenedName("form.PDF")).toBe("form_flattened.pdf");
  });
});
