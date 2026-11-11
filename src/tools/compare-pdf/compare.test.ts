import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf } from "../../../tests/fixtures/pdf";
import { buildComparison, comparedName, diffWords, normalise } from "./compare";

// The fewest removals and additions that turn one list into the other, worked out the slow, sure way.
function fewestEdits(a: string[], b: string[]) {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  return a.length + b.length - 2 * table[0][0];
}

describe("diffWords", () => {
  it("finds the words removed and added", () => {
    const before = "the rent is due on the first of each month".split(" ");
    const after = "the rent is due on the fifth day of each month".split(" ");
    expect(diffWords(before, after)).toEqual({ removed: [6], added: [6, 7] });
  });

  it("handles empty, equal and wholly different texts", () => {
    expect(diffWords([], ["a"])).toEqual({ removed: [], added: [0] });
    expect(diffWords(["a", "b"], ["a", "b"])).toEqual({ removed: [], added: [] });
    expect(diffWords(["a", "b"], ["c"])).toEqual({ removed: [0, 1], added: [0] });
  });

  it("always finds the fewest changes, and what's left matches", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 300; round++) {
      const a = Array.from({ length: Math.floor(next() * 30) }, () => "abcde"[Math.floor(next() * 5)]);
      const b = Array.from({ length: Math.floor(next() * 30) }, () => "abcde"[Math.floor(next() * 5)]);
      const { removed, added } = diffWords(a, b);
      expect(removed.length + added.length).toBe(fewestEdits(a, b));
      expect(a.filter((_, index) => !removed.includes(index))).toEqual(b.filter((_, index) => !added.includes(index)));
    }
  });

  it("copes with long documents that differ a little", () => {
    const a = Array.from({ length: 20000 }, (_, index) => `w${index % 997}`);
    const b = [...a];
    b.splice(5000, 3, "new", "words");
    b.splice(15000, 0, "inserted");
    const { removed, added } = diffWords(a, b);
    expect(removed).toEqual([5000, 5001, 5002]);
    expect(added).toEqual([5000, 5001, 15000]);
  });
});

describe("normalise", () => {
  it("ignores quotes and punctuation around a word", () => {
    expect(normalise("“Tenant,”")).toBe("Tenant");
    expect(normalise("(month).")).toBe("month");
    expect(normalise("বাংলা।")).toBe("বাংলা।");
  });
});

async function onePager(text: string, turn = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 400]);
  page.drawText(text, { x: 30, y: 350, size: 12, font });
  page.setRotation(degrees(turn));
  return doc.save();
}

describe("buildComparison", () => {
  it("puts each pair of pages side by side, both pages still readable", async () => {
    const result = await buildComparison(
      { name: "lease.pdf", bytes: await onePager("Rent due on the first"), removed: [{ text: "first", page: 1, x: 0.4, y: 0.1, width: 0.1, height: 0.04 }] },
      { name: "lease-v2.pdf", bytes: await onePager("Rent due on the fifth", 90), added: [] },
      { before: "Original", after: "Changed" },
    );
    const doc = await pdfjs.getDocument({ data: result.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
    expect(doc.numPages).toBe(1);
    const { items } = await (await doc.getPage(1)).getTextContent();
    const text = items.map((item) => ("str" in item ? item.str : "")).join(" ");
    for (const piece of ["Original: lease.pdf", "Changed: lease-v2.pdf", "Rent due on the first", "Rent due on the fifth"]) expect(text).toContain(piece);
  });

  it("says which file is locked", async () => {
    await expect(
      buildComparison({ name: "a.pdf", bytes: await onePager("a"), removed: [] }, { name: "b.pdf", bytes: await makeEncryptedPdf(), added: [] }, { before: "O", after: "C" }),
    ).rejects.toMatchObject({ code: "encrypted", detail: "after" });
    expect(comparedName("lease-v2.pdf")).toBe("lease-v2_compared.pdf");
  });
});
