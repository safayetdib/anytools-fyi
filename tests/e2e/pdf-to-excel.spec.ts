import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-excel";
const PAGE = "/pdf-to-excel/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A two-page bank statement: a title, a table with a bold heading row, and amounts set to the right.
async function statement(name = "statement.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const rows = [
    ["02 May", "Rice and dal", "1,250.00"],
    ["05 May", "Bus fare", "75.00"],
  ];
  for (const [index, title] of ["Statement for May", "Statement for June"].entries()) {
    const page = doc.addPage([595, 842]);
    page.drawText(title, { x: 50, y: 780, size: 14, font: bold });
    for (const [at, text] of ["Date", "Details", "Amount"].entries()) page.drawText(text, { x: [50, 150, 450][at], y: 720, size: 10, font: bold });
    for (const [row, cells] of rows.entries()) {
      const y = 700 - row * 16;
      page.drawText(cells[0], { x: 50, y, size: 10, font });
      page.drawText(cells[1], { x: 150, y, size: 10, font });
      // Amounts end at the same place, as a statement sets them.
      page.drawText(cells[2], { x: 500 - font.widthOfTextAtSize(cells[2], 10), y, size: 10, font });
    }
    page.drawText(`Page ${index + 1}`, { x: 50, y: 60, size: 9, font });
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// Only a drawing on its page, like a scan.
async function scan(name = "scan.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]).drawRectangle({ x: 20, y: 20, width: 100, height: 100 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to Excel", exact: true });
const cards = (page: Page) => page.getByTestId("excel-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^(Your file is ready|Your \d+ files are ready)$/ })).toBeVisible({ timeout: 30000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

const sheetOf = (files: Record<string, Uint8Array>, number: number) => new TextDecoder().decode(files[`xl/worksheets/sheet${number}.xml`]);
// Each row's cells as text, and the numbers among them as numbers.
const rowsOf = (sheet: string) =>
  [...sheet.matchAll(/<row r="(\d+)">(.*?)<\/row>/g)].map(([, number, row]) => [
    Number(number),
    ...[...row.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<is><t[^>]*>([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)].map(([, column, text, value]) => `${column}:${text ?? Number(value)}`),
  ]);

test("pdf to excel - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to Excel" })).toBeVisible();
  for (const heading of ["How to convert a PDF to Excel", "How converting to Excel works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-excel.png");
});

test("pdf to excel - tables come out in columns, figures as numbers, a sheet for each page", async ({ page }) => {
  await choose(page, [await statement()]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("statement.xlsx");
  const files = unzipSync(bytes);
  expect(new TextDecoder().decode(files["xl/workbook.xml"])).toContain('<sheet name="Page 1" sheetId="1" r:id="rIdSheet1"/><sheet name="Page 2" sheetId="2" r:id="rIdSheet2"/>');
  expect(rowsOf(sheetOf(files, 1))).toEqual([
    [1, "A:Statement for May"],
    [3, "A:Date", "B:Details", "C:Amount"],
    [4, "A:02 May", "B:Rice and dal", "C:1250"],
    [5, "A:05 May", "B:Bus fare", "C:75"],
    [7, "A:Page 1"],
  ]);
  // The heading row is bold.
  expect(sheetOf(files, 1)).toMatch(/<c r="A3" s="1" t="inlineStr">/);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("pdf to excel - all pages can go on one sheet, and several PDFs come in a ZIP", async ({ page }) => {
  await choose(page, [await statement("a.pdf"), await statement("b.pdf")]);
  await page.getByLabel("All pages on one sheet").check();
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pdf-to-excel.zip");
  const zip = unzipSync(bytes);
  expect(Object.keys(zip).sort()).toEqual(["a.xlsx", "b.xlsx"]);
  const files = unzipSync(zip["a.xlsx"]);
  expect(new TextDecoder().decode(files["xl/workbook.xml"])).toContain('<sheet name="All pages" sheetId="1" r:id="rIdSheet1"/></sheets>');
  expect(rowsOf(sheetOf(files, 1)).map((row) => row[1])).toEqual(["A:Statement for May", "A:Date", "A:02 May", "A:05 May", "A:Page 1", "A:Statement for June", "A:Date", "A:02 May", "A:05 May", "A:Page 2"]);
});

test("pdf to excel - a scan without text points to OCR PDF", async ({ page }) => {
  await choose(page, [await scan()]);
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("scan.pdf has no text to take out");
  await expect(page.getByTestId("shell-error").first()).toContainText("OCR PDF");
});

test("pdf to excel - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to excel - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await statement("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to excel - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await statement()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 30000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
