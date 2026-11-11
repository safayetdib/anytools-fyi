import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FontStyle, TextPiece } from "../../lib/pdf/page-content";
import { buildGrid, cellValue } from "./table";
import { joinGrids } from "./tool";
import { buildXlsx, columnName, excelName } from "./xlsx";

const plain: FontStyle = { family: "Arial", bold: false, italic: false };
const piece = (text: string, x: number, baseline: number, bold = false): TextPiece => ({
  text,
  x,
  baseline,
  width: text.length * 5,
  size: 10,
  font: { ...plain, bold },
  upright: true,
  angle: 0,
});
const texts = (rows: ReturnType<typeof buildGrid>["rows"]) => rows.map((row) => Array.from(row, (cell) => cell?.text ?? ""));

describe("buildGrid", () => {
  it("lines up a statement's columns, even with figures set to the right", () => {
    const grid = buildGrid([
      piece("Statement for May", 50, 40, true),
      piece("Date", 50, 80, true),
      piece("Details", 120, 80, true),
      piece("Amount", 300, 80, true),
      piece("02 May", 50, 95),
      piece("Rice and dal", 120, 95),
      piece("1,250.00", 295, 95),
      piece("05 May", 50, 110),
      piece("Bus", 120, 110),
      piece("75.00", 310, 110),
    ]);
    expect(texts(grid.rows)).toEqual([["Statement for May"], [], ["Date", "Details", "Amount"], ["02 May", "Rice and dal", "1,250.00"], ["05 May", "Bus", "75.00"]]);
    expect(grid.rows[2][0]?.bold).toBe(true);
    expect(grid.widths).toHaveLength(3);
  });

  it("puts a page without columns in the first column, a row for each line", () => {
    const grid = buildGrid([piece("Dear Rahim,", 50, 100), piece("Thank you.", 50, 115)]);
    expect(texts(grid.rows)).toEqual([["Dear Rahim,"], ["Thank you."]]);
  });

  it("joins pages on one sheet with an empty row between", () => {
    const a = buildGrid([piece("A", 50, 100), piece("1", 200, 100)]);
    const b = buildGrid([piece("B", 50, 100)]);
    expect(texts(joinGrids([a, b]).rows)).toEqual([["A", "1"], [], ["B"]]);
  });
});

describe("cellValue", () => {
  it("reads plain numbers, amounts and percentages as numbers", () => {
    expect(cellValue("1,250.00")).toEqual({ kind: "number", value: 1250, format: "decimal" });
    expect(cellValue("12,500")).toEqual({ kind: "number", value: 12500, format: "whole" });
    expect(cellValue("(75.50)")).toEqual({ kind: "number", value: -75.5, format: "general" });
    expect(cellValue("−12")).toEqual({ kind: "number", value: -12, format: "general" });
    expect(cellValue("15%")).toEqual({ kind: "number", value: 0.15, format: "percent" });
    expect(cellValue("0.5")).toEqual({ kind: "number", value: 0.5, format: "general" });
  });

  it("keeps codes, phone numbers, dates and words as text", () => {
    for (const text of ["007", "01712345678", "12345678901234567", "02 May", "৳ 500", "1.2.3", "(12", "Total"]) {
      expect(cellValue(text).kind).toBe("text");
    }
  });
});

describe("buildXlsx", () => {
  it("writes numbers as numbers, text as text, bold as bold, with a sheet for each page", () => {
    const grid = buildGrid([piece("Item", 50, 80, true), piece("Price", 200, 80, true), piece("Rice & dal", 50, 95), piece("1,250.00", 200, 95)]);
    const files = unzipSync(buildXlsx([{ name: "Page 1", grid }, { name: "Page 1", grid: { rows: [], widths: [] } }], "May"));
    const sheet = new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Item</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Rice &amp; dal</t></is></c>');
    expect(sheet).toMatch(/<c r="B2" s="\d"><v>1250<\/v><\/c>/);
    const workbook = new TextDecoder().decode(files["xl/workbook.xml"]);
    // Sheet names must be unique.
    expect(workbook).toContain('<sheet name="Page 1" sheetId="1" r:id="rIdSheet1"/><sheet name="Page 1 2" sheetId="2" r:id="rIdSheet2"/>');
    expect(new TextDecoder().decode(files["xl/styles.xml"])).toContain('<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>');
  });

  it("names columns the way Excel does", () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "ZZ", "AAA"]);
    expect(excelName("statement.PDF")).toBe("statement.xlsx");
  });
});
