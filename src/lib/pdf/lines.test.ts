import { describe, expect, it } from "vitest";
import { buildLines, cellsOf } from "./lines";
import { fontStyle, type TextPiece } from "./page-content";

const plain = { family: "Arial", bold: false, italic: false };
const piece = (text: string, x: number, baseline: number, width = text.length * 6, size = 12): TextPiece => ({ text, x, baseline, width, size, font: plain, upright: true });

describe("buildLines", () => {
  it("joins pieces on a line, with spaces where the gaps are", () => {
    const lines = buildLines([piece("Dear", 50, 100, 24), piece("Ra", 78, 100, 12), piece("him,", 90, 100, 24), piece("Next line", 50, 115)]);
    expect(lines.map((line) => line.text)).toEqual(["Dear Rahim,", "Next line"]);
    expect(lines[0]).toMatchObject({ x: 50, right: 114, baseline: 100, columns: false });
  });

  it("keeps the spaces a PDF draws as pieces of their own", () => {
    expect(buildLines([piece("one", 50, 100, 18), piece(" ", 68, 100, 3), piece("two", 71, 100, 18)])[0].text).toBe("one two");
  });

  it("marks wide gaps as columns, like a table row", () => {
    const [line] = buildLines([piece("Rice", 50, 100, 24), piece("120.50", 200, 100, 36), piece("৳ 3", 300, 100, 18)]);
    expect(line.columns).toBe(true);
    expect(line.text).toBe("Rice\t120.50\t৳ 3");
    expect(cellsOf(line).map((cell) => [cell.text, cell.x])).toEqual([
      ["Rice", 50],
      ["120.50", 200],
      ["৳ 3", 300],
    ]);
  });

  it("puts list numbers drawn after their text back at the start of the line", () => {
    const lines = buildLines([piece("Round Robin", 70, 100), piece("Least Connections", 70, 115), piece("1.", 54, 100, 10), piece("2.", 54, 115, 10)]);
    expect(lines.map((line) => line.text)).toEqual(["1. Round Robin", "2. Least Connections"]);
    expect(lines[0].x).toBe(54);
  });

  it("starts a new line when the text moves back or down, and for turned text", () => {
    const turned = { ...piece("Side", 10, 300), upright: false };
    const lines = buildLines([piece("Right", 300, 100), piece("Left", 50, 100), turned]);
    expect(lines.map((line) => line.text)).toEqual(["Right", "Left", "Side"]);
  });
});

describe("fontStyle", () => {
  it("names fonts the way Office does, with bold and italic", () => {
    expect(fontStyle("ABCDEF+TimesNewRomanPS-BoldItalicMT")).toEqual({ family: "Times New Roman", bold: true, italic: true });
    expect(fontStyle("Helvetica-Oblique")).toEqual({ family: "Arial", bold: false, italic: true });
    expect(fontStyle("Calibri,Bold")).toEqual({ family: "Calibri", bold: true, italic: false });
    expect(fontStyle("ArialBold")).toEqual({ family: "Arial", bold: true, italic: false });
    expect(fontStyle("NotoSansBengali-SemiBold").family).toBe("Noto Sans Bengali");
    expect(fontStyle("SourceSansPro-Regular").family).toBe("Source Sans Pro");
  });

  it("falls back to the kind of font when it has no usable name", () => {
    expect(fontStyle("GlyphLessFont")).toEqual({ family: null, bold: false, italic: false });
    expect(fontStyle(undefined, { serif: true, bold: true })).toEqual({ family: "Times New Roman", bold: true, italic: false });
    expect(fontStyle("", { mono: true }).family).toBe("Courier New");
  });
});
