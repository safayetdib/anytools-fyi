import { XML_HEAD, packOffice, xml } from "../../lib/office/ooxml";
import { cellValue, type Grid } from "./table";

// Writes the Excel file: a sheet for each grid, with numbers stored as numbers and bold text kept bold.

export interface Sheet {
  name: string;
  grid: Grid;
}

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
// Excel's own number formats: whole numbers with thousands separators, the same with two decimals, and percentages.
const FORMATS = { general: 0, whole: 3, decimal: 4, percent: 10 } as const;
// Points a character of the default font takes, for column widths.
const POINTS_PER_CHARACTER = 5.5;

// "A", "B", … "Z", "AA", …
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Sheet names can't hold some characters, must be unique, and must be 31 characters or fewer.
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const clean = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
    let unique = clean;
    for (let copy = 2; used.has(unique.toLowerCase()); copy++) unique = `${clean.slice(0, 31 - String(copy).length - 1)} ${copy}`;
    used.add(unique.toLowerCase());
    return unique;
  });
}

export function buildXlsx(sheets: Sheet[], title: string): Uint8Array {
  // Each pair of bold and number format gets one style.
  const styles: [boolean, number][] = [[false, 0]];
  const styleFor = (bold: boolean, format: number) => {
    let index = styles.findIndex(([b, f]) => b === bold && f === format);
    if (index < 0) index = styles.push([bold, format]) - 1;
    return index;
  };
  const names = sheetNames(sheets.map((sheet) => sheet.name));
  const parts: Record<string, string> = {};
  for (const [index, sheet] of sheets.entries()) {
    const { rows, widths } = sheet.grid;
    const longest: number[] = [];
    const rowsXml = rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            if (!cell || !cell.text.trim()) return "";
            longest[c] = Math.max(longest[c] ?? 0, Math.min(60, cell.text.length));
            const ref = `${columnName(c)}${r + 1}`;
            const value = cellValue(cell.text);
            if (value.kind === "number") {
              const style = styleFor(cell.bold, FORMATS[value.format]);
              return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value.value}</v></c>`;
            }
            const style = styleFor(cell.bold, 0);
            return `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
          })
          .join("");
        return cells ? `<row r="${r + 1}">${cells}</row>` : "";
      })
      .join("");
    const count = Math.max(widths.length, longest.length);
    const cols = Array.from({ length: count }, (_, c) => {
      const fromPage = (widths[c] ?? 0) / POINTS_PER_CHARACTER;
      const width = Math.min(80, Math.max(8, fromPage + 2, (longest[c] ?? 0) + 2));
      return `<col min="${c + 1}" max="${c + 1}" width="${width.toFixed(1)}" customWidth="1"/>`;
    }).join("");
    parts[`xl/worksheets/sheet${index + 1}.xml`] =
      `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">` +
      (cols ? `<cols>${cols}</cols>` : "") +
      `<sheetData>${rowsXml}</sheetData></worksheet>`;
  }
  const stylesXml =
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${styles.length}">` +
    styles
      .map(([bold, format]) => `<xf numFmtId="${format}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${bold ? ' applyFont="1"' : ""}${format ? ' applyNumberFormat="1"' : ""}/>`)
      .join("") +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";
  return packOffice({
    "[Content_Types].xml":
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>",
    "_rels/.rels":
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>",
    "docProps/core.xml":
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${xml(title)}</dc:title></cp:coreProperties>`,
    "xl/workbook.xml":
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>` +
      names.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rIdSheet${index + 1}"/>`).join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets.map((_, index) => `<Relationship Id="rIdSheet${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("") +
      `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>` +
      "</Relationships>",
    "xl/styles.xml": stylesXml,
    ...parts,
  });
}

// Like most PDF tools: "statement.pdf" becomes "statement.xlsx".
export function excelName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}.xlsx`;
}
