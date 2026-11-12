import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makeBijoyPdf, makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/bangla-pdf-to-unicode";
const PAGE = "/bangla-pdf-to-unicode/";
const NOTICE = ["গণপ্রজাতন্ত্রী বাংলাদেশ সরকার", "আমি বাংলায় দেখি স্বপ্ন!", "Ref: 12/2024"].map((line) => line.normalize("NFC"));

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A notice typed in SutonnyMJ, with an English reference line.
async function notice(name = "notice.pdf"): Promise<Upload> {
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await makeBijoyPdf()) };
}

// A PDF in English only, with no Bijoy text to turn.
async function plain(name = "plain.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText("Hello", { x: 30, y: 150, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to Unicode", exact: true });
const cards = (page: Page) => page.getByTestId("unicode-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^(Your result|Your file is ready|Your \d+ files are ready)$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("bangla pdf to unicode - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Bangla PDF to Unicode" })).toBeVisible();
  for (const heading of ["How to convert a Bijoy PDF to Unicode", "How converting to Unicode works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/bangla-pdf-to-unicode.png");
});

test("bangla pdf to unicode - Bijoy text comes out as Unicode Bangla, shown and saved", async ({ page }) => {
  await choose(page, [await notice()]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("notice.txt");
  // The lines sit far apart, so each is a paragraph of its own.
  expect(new TextDecoder().decode(bytes)).toBe(`${NOTICE.join("\n\n")}\n`);
  await expect(page.getByTestId("shell-output")).toHaveText(NOTICE.join("\n\n"));
  await expect(page.getByTestId("shell-result-card")).toContainText("Its Bijoy text is now Unicode Bangla");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("bangla pdf to unicode - Word keeps the Unicode Bangla, set in a Bangla font", async ({ page }) => {
  await choose(page, [await notice()]);
  await page.getByTestId("unicode-options").getByRole("radio", { name: "Word" }).check();
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("notice.docx");
  const body = strFromU8(unzipSync(bytes)["word/document.xml"]);
  for (const line of NOTICE) expect(body).toContain(line);
  expect(body).toContain('w:cs="Nirmala UI"');
});

test("bangla pdf to unicode - several PDFs come in a ZIP, and one with no Bijoy text says so", async ({ page }) => {
  await choose(page, [await notice("a.pdf"), await plain("b.pdf")]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_bangla-pdf-to-unicode.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(["a.txt", "b.txt"]);
  expect(strFromU8(files["b.txt"])).toBe("Hello\n");
  await expect(page.getByTestId("shell-result-card")).toContainText("Bijoy text in 1 of them is now Unicode Bangla. 1 had no Bijoy text");
});

test("bangla pdf to unicode - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`bangla pdf to unicode - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await notice("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`bangla pdf to unicode - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await notice()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: /^(Your result|Your file is ready)$/ })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
