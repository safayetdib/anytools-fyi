import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { makeBijoyPdf } from "../../../tests/fixtures/pdf";
import { readPageContent, readText } from "./page-content";

async function firstPage(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, fontExtraProperties: true, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  return doc.getPage(1) as never;
}

describe("readText", () => {
  it("turns text in a Bijoy font into Unicode Bangla and leaves other fonts alone", async () => {
    const page = await firstPage(await makeBijoyPdf());
    await (page as { getOperatorList: () => Promise<unknown> }).getOperatorList();
    const { items, bijoyFonts } = await readText(page);
    expect(items.map((item) => item.str).filter(Boolean)).toEqual(["গণপ্রজাতন্ত্রী বাংলাদেশ সরকার", "আমি বাংলায় দেখি স্বপ্ন!".normalize("NFC"), "Ref: 12/2024"]);
    expect(bijoyFonts.size).toBe(1);
  });

  it("gives converted text a font with Bangla letters, for Word and PowerPoint", async () => {
    const { pieces } = await readPageContent(await firstPage(await makeBijoyPdf()), { pictures: false });
    expect(pieces.map((piece) => [piece.text, piece.font.family])).toEqual([
      ["গণপ্রজাতন্ত্রী বাংলাদেশ সরকার", "Nirmala UI"],
      ["আমি বাংলায় দেখি স্বপ্ন!".normalize("NFC"), "Nirmala UI"],
      ["Ref: 12/2024", "Times New Roman"],
    ]);
  });
});
