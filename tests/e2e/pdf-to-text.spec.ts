import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-text";
const PAGE = "/pdf-to-text/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A two-page letter with a gap between its paragraphs.
async function letter(name = "letter.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([300, 400]);
  first.drawText("Dear Rahim,", { x: 30, y: 350, size: 12, font });
  first.drawText("Your order has shipped.", { x: 30, y: 310, size: 12, font });
  first.drawText("It arrives on Monday.", { x: 30, y: 295, size: 12, font });
  doc.addPage([300, 400]).drawText("Thank you.", { x: 30, y: 350, size: 12, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// Only a drawing on its page, like a scan.
async function scan(name = "scan.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]).drawRectangle({ x: 20, y: 20, width: 100, height: 100 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to text", exact: true });
const cards = (page: Page) => page.getByTestId("text-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^(Your result|Your \d+ files are ready)$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("pdf to text - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to text" })).toBeVisible();
  for (const heading of ["How to convert a PDF to text", "How converting to text works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-text.png");
});

test("pdf to text - the words come out in order, with pages marked, shown and saved", async ({ page }) => {
  await choose(page, [await letter()]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("letter.txt");
  const expected = "--- Page 1 ---\n\nDear Rahim,\n\nYour order has shipped.\nIt arrives on Monday.\n\n--- Page 2 ---\n\nThank you.\n";
  expect(new TextDecoder().decode(bytes)).toBe(expected);
  await expect(page.getByTestId("shell-output")).toHaveText(expected.trimEnd());
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("pdf to text - pages can go unmarked, and several PDFs come in a ZIP", async ({ page }) => {
  await choose(page, [await letter("a.pdf"), await letter("b.pdf")]);
  await page.getByLabel("Mark where each page starts").uncheck();
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pdf-to-text.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(["a.txt", "b.txt"]);
  expect(new TextDecoder().decode(files["a.txt"])).toBe("Dear Rahim,\n\nYour order has shipped.\nIt arrives on Monday.\n\nThank you.\n");
});

test("pdf to text - a scan without text points to OCR PDF", async ({ page }) => {
  await choose(page, [await scan()]);
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("scan.pdf has no text to take out");
  await expect(page.getByTestId("shell-error").first()).toContainText("OCR PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to text - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await letter("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to text - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await letter()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your result" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
