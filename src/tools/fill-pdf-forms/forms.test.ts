import { readFileSync } from "node:fs";
import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf } from "../../../tests/fixtures/pdf";
import { fillForm, filledName, readAnswers, readForm } from "./forms";

// An application form: a name box, a ticked box, a round choice of two and a drop-down, on a 300 by 400 page.
async function application(turn = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const form = doc.getForm();
  form.createTextField("name").addToPage(page, { x: 30, y: 340, width: 200, height: 20 });
  form.createCheckBox("agree").addToPage(page, { x: 30, y: 300, width: 12, height: 12 });
  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("Basic", page, { x: 30, y: 260, width: 12, height: 12 });
  plan.addOptionToPage("Plus", page, { x: 90, y: 260, width: 12, height: 12 });
  const city = form.createDropdown("city");
  city.addOptions(["Dhaka", "Chattogram", "Sylhet"]);
  city.addToPage(page, { x: 30, y: 220, width: 120, height: 20 });
  // Turned afterwards, so the boxes keep their places on the page itself.
  page.setRotation(degrees(turn));
  return doc.save();
}

async function textOf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const { items } = await (await doc.getPage(1)).getTextContent();
  return items.map((item) => ("str" in item ? item.str : "")).join(" ");
}

describe("readForm", () => {
  it("lists each field with its boxes where the page shows them", async () => {
    const fields = await readForm(await application());
    expect(fields.map((field) => [field.name, field.kind])).toEqual([
      ["name", "text"],
      ["agree", "checkbox"],
      ["plan", "radio"],
      ["city", "dropdown"],
    ]);
    const [name, , plan, city] = fields;
    // Boxes reach half a point past their edges for their border.
    const [spot] = name.spots;
    expect([spot.page, spot.x, spot.y, spot.width, spot.height].map((value) => Math.round(value * 100) / 100)).toEqual([1, 0.1, 0.1, 0.67, 0.05]);
    expect(plan.spots.map((spot) => spot.option)).toEqual(["Basic", "Plus"]);
    expect(city.options).toEqual(["Dhaka", "Chattogram", "Sylhet"]);
  });

  it("places boxes on a turned page as it's shown", async () => {
    const [name] = await readForm(await application(90));
    // Turned clockwise, the page is 400 wide and 300 tall: the box's left edge, 30 points in, is now its top, and its
    // place near the page's top is now near the right.
    const [spot] = name.spots;
    expect([spot.x, spot.y, spot.width, spot.height].map((value) => Math.round(value * 100) / 100)).toEqual([0.85, 0.1, 0.05, 0.67]);
  });

  it("finds no fields in an ordinary PDF, and refuses a locked one", async () => {
    expect(await readForm(await makePdf([200]))).toEqual([]);
    await expect(readForm(await makeEncryptedPdf())).rejects.toMatchObject({ code: "encrypted" });
  });
});

describe("fillForm", () => {
  it("fills in every kind of field, kept editable", async () => {
    const result = await fillForm(await application(), { name: "Nusrat Jahan", agree: true, plan: "Plus", city: "Sylhet" }, false);
    const form = (await PDFDocument.load(result)).getForm();
    expect(form.getTextField("name").getText()).toBe("Nusrat Jahan");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("plan").getSelected()).toBe("Plus");
    expect(form.getDropdown("city").getSelected()).toEqual(["Sylhet"]);
  });

  it("flattens the answers into the page, so they can't be changed", async () => {
    const result = await fillForm(await application(), { name: "Nusrat Jahan", city: "Dhaka" }, true);
    expect((await PDFDocument.load(result)).getForm().getFields()).toEqual([]);
    const text = await textOf(result);
    expect(text).toContain("Nusrat Jahan");
    expect(text).toContain("Dhaka");
  });

  it("keeps Bangla answers for readers to draw, and draws them as pictures when flattening", async () => {
    const kept = await fillForm(await application(), { name: "নুসরাত জাহান" }, false);
    const doc = await PDFDocument.load(kept);
    expect(doc.getForm().getTextField("name").getText()).toBe("নুসরাত জাহান");
    expect(doc.getForm().acroForm.dict.get((await import("pdf-lib")).PDFName.of("NeedAppearances"))?.toString()).toBe("true");
    const picture = { bytes: new Uint8Array(readFileSync("tests/fixtures/images/logo.png")), kind: "png" as const, width: 60, ascent: 10, descent: 3, pad: 3 };
    const flat = await fillForm(await application(), { name: "নুসরাত জাহান" }, true, { name: picture });
    const flatDoc = await PDFDocument.load(flat);
    expect(flatDoc.getForm().getFields()).toEqual([]);
    // One picture among the flattened fields' drawings.
    const { PDFDict, PDFName, PDFStream } = await import("pdf-lib");
    const objects = flatDoc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    const pictures = (objects?.keys() ?? []).filter((key) => objects?.lookup(key, PDFStream)?.dict.get(PDFName.of("Subtype"))?.toString() === "/Image");
    expect(pictures).toHaveLength(1);
  });

  it("cuts text to a field's limit and leaves read-only fields alone", async () => {
    const doc = await PDFDocument.load(await application());
    doc.getForm().getTextField("name").setMaxLength(5);
    doc.getForm().getDropdown("city").enableReadOnly();
    const result = await fillForm(await doc.save(), { name: "Nusrat Jahan", city: "Sylhet" }, false);
    const form = (await PDFDocument.load(result)).getForm();
    expect(form.getTextField("name").getText()).toBe("Nusra");
    expect(form.getDropdown("city").getSelected()).toEqual([]);
  });

  it("says when a PDF has no form", async () => {
    await expect(fillForm(await makePdf([200]), { name: "x" }, false)).rejects.toMatchObject({ code: "noFields" });
  });
});

describe("readAnswers", () => {
  it("keeps text, ticks and lists, and drops the rest", () => {
    expect(readAnswers(JSON.stringify({ a: "x", b: true, c: ["1", 2], d: 5, e: null }))).toEqual({ a: "x", b: true, c: ["1"] });
    expect(readAnswers("[1]")).toEqual({});
    expect(filledName("application.pdf")).toBe("application_filled.pdf");
  });
});
