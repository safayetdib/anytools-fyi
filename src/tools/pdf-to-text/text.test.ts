import { describe, expect, it } from "vitest";
import { documentText, hasAnyText, pageText, textName, type Piece } from "./text";

const piece = (str: string, y: number, hasEOL = false, size = 12): Piece => ({ str, y, size, hasEOL });

describe("pageText", () => {
  it("keeps the PDF's lines and spots paragraph gaps", () => {
    const pieces = [
      piece("Dear ", 700),
      piece("Rahim,", 700, true),
      piece("Your order has shipped.   ", 670, true),
      // A gap of three lines starts a new paragraph.
      piece("Thank you.", 634, true),
      piece("", 634, true),
      piece("আমার সোনার বাংলা", 620, true),
    ];
    expect(pageText(pieces)).toBe("Dear Rahim,\n\nYour order has shipped.\n\nThank you.\nআমার সোনার বাংলা");
  });

  it("is empty for a page with no text", () => {
    expect(pageText([])).toBe("");
    expect(pageText([piece(" ", 500, true)])).toBe("");
  });
});

describe("documentText", () => {
  it("joins pages, with a marker before each when asked", () => {
    expect(documentText(["One", "Two"], (page) => `--- Page ${page} ---`)).toBe("--- Page 1 ---\n\nOne\n\n--- Page 2 ---\n\nTwo\n");
    expect(documentText(["One", "", "Three"], null)).toBe("One\n\nThree\n");
    expect(hasAnyText(["", " "])).toBe(false);
    expect(textName("report.PDF")).toBe("report.txt");
  });
});
