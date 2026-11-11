import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, PageSizes, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/resize-pdf";
const PAGE = "/resize-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A Letter page, a small wide page, a Legal page and a tall receipt, each with its number on it.
async function mixed(name = "notes.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, size] of [PageSizes.Letter, [400, 200], PageSizes.Legal, [200, 500]].entries()) {
    doc.addPage(size as [number, number]).drawText(`Page ${index + 1}`, { x: 20, y: size[1] - 40, size: 12, font });
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Resize PDF", exact: true });
const cards = (page: Page) => page.getByTestId("resize-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function resizeAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// Each page's size as shown, and its text.
async function pagesOf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join(" ").trim();
    pages.push(`${Math.round(width)}x${Math.round(height)} ${text}`);
  }
  return pages;
}

test("resize pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Resize PDF" })).toBeVisible();
  for (const heading of ["How to resize a PDF", "How resizing works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/resize-pdf.png");
});

test("resize pdf - every page fits A4, turned to suit its shape", async ({ page }) => {
  await choose(page, [await mixed()]);
  const { name, bytes } = await resizeAndDownload(page);
  expect(name).toBe("notes_resized.pdf");
  expect(await pagesOf(bytes)).toEqual(["595x842 Page 1", "842x595 Page 2", "595x842 Page 3", "595x842 Page 4"]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("resize pdf - Letter, sideways, with 2 pages on each sheet", async ({ page }) => {
  await choose(page, [await mixed()]);
  const options = page.getByTestId("resize-options");
  await options.getByRole("radio", { name: "Letter" }).check();
  await options.getByRole("radio", { name: "Landscape" }).check();
  await options.getByRole("radio", { name: "Small" }).check();
  await options.getByRole("group", { name: "Pages per sheet" }).getByRole("radio", { name: "2" }).check();
  const { bytes } = await resizeAndDownload(page);
  expect(await pagesOf(bytes)).toEqual(["792x612 Page 1 Page 2", "792x612 Page 3 Page 4"]);
});

test("resize pdf - several PDFs come in a ZIP", async ({ page }) => {
  await choose(page, [await mixed("a.pdf"), await mixed("b.pdf")]);
  const { name, bytes } = await resizeAndDownload(page);
  expect(name).toBe("anytools_resize-pdf.zip");
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["a_resized.pdf", "b_resized.pdf"]);
});

test("resize pdf - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`resize pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await mixed("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`resize pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await mixed()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
