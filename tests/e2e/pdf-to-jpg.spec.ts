import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-jpg";
const PAGE = "/pdf-to-jpg/";

const pdf = async (name: string, widths: number[], height = 300) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf(widths, height)) });

// A PDF with two photos on page 1, the same photo again on page 2, and a page with none.
async function photoPdf(name = "photos.pdf") {
  const doc = await PDFDocument.create();
  const tall = await doc.embedJpg(await readFile("tests/fixtures/images/tall.jpg"));
  const logo = await doc.embedPng(await readFile("tests/fixtures/images/logo.png"));
  const first = doc.addPage([595, 842]);
  first.drawImage(tall, { x: 50, y: 400, width: 300, height: 400 });
  first.drawImage(logo, { x: 400, y: 400, width: 100, height: 100 });
  doc.addPage([595, 842]).drawImage(tall, { x: 50, y: 50, width: 150, height: 200 });
  doc.addPage([595, 842]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("pdf-jpg-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Convert to JPG", exact: true });
const choice = (page: Page, name: string) => panel(page).getByRole("radio", { name: new RegExp(`^${name}`) });
const info = (page: Page) => page.getByTestId("pdf-jpg-info");

async function jpegSize(bytes: Uint8Array) {
  // The size from the first frame header in the JPG.
  for (let at = 2; at < bytes.length; ) {
    const marker = (bytes[at] << 8) | bytes[at + 1];
    if (marker >= 0xffc0 && marker <= 0xffc3) return [(bytes[at + 7] << 8) | bytes[at + 8], (bytes[at + 5] << 8) | bytes[at + 6]];
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  return [0, 0];
}

async function choose(page: Page, files: Awaited<ReturnType<typeof pdf>>[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(files);
  await expect(page.getByTestId("pdf-jpg-card")).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("pdf to jpg - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to JPG" })).toBeVisible();
  for (const heading of ["How to convert PDF to JPG", "How converting works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/pdf-to-jpg/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-jpg.png");
});

test("pdf to jpg - starts like other tools: Page to JPG, Normal, with the count", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", [101, 102, 103])]);
  await expect(panel(page).getByRole("heading", { name: "PDF to JPG options" })).toBeVisible();
  await expect(choice(page, "Page to JPG")).toBeChecked();
  await expect(choice(page, "Normal")).toBeChecked();
  await expect(info(page)).toHaveText("Every page of this PDF will be converted into a JPG file. 3 JPG will be created.");
  await expect(info(page).locator("strong")).toHaveText("3 JPG");
  await expect(page.getByTestId("pdf-jpg-card")).toContainText("3 pages");
});

test("pdf to jpg - pages become JPGs in a ZIP, named and sized like other tools", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", [595, 595], 842)]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pages-to-jpg.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["report_page-0001.jpg", "report_page-0002.jpg"]);
  expect(await jpegSize(files["report_page-0001.jpg"])).toEqual([1240, 1755]);
  await expect(page.getByTestId("shell-part")).toHaveCount(2);
  await expect(page.getByTestId("shell-part").locator("img")).toHaveCount(2);
});

test("pdf to jpg - one page gives one JPG, and High doubles the detail", async ({ page }) => {
  await choose(page, [await pdf("letter.pdf", [612], 792)]);
  await choice(page, "High").check();
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("letter_page-0001.jpg");
  expect(await jpegSize(bytes)).toEqual([2550, 3300]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("pdf to jpg - Extract images saves each picture once, at its own size", async ({ page }) => {
  await choose(page, [await photoPdf()]);
  await choice(page, "Extract images").check();
  await expect(panel(page)).toContainText("All embedded images inside the PDF will be extracted as JPG images.");
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_images-from-pdf.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["photos_image-0001.jpg", "photos_image-0002.jpg"]);
  expect(await jpegSize(files["photos_image-0001.jpg"])).toEqual([600, 800]);
  expect(await jpegSize(files["photos_image-0002.jpg"])).toEqual([400, 400]);
});

test("pdf to jpg - a PDF without pictures says so and suggests Page to JPG", async ({ page }) => {
  await choose(page, [await pdf("text.pdf", [101])]);
  await choice(page, "Extract images").check();
  await runButton(page).click();
  await expect(page.getByTestId("shell-error")).toContainText("No pictures were found in text.pdf. Choose Page to JPG to save its pages as pictures instead.");
});

test("pdf to jpg - several PDFs count and convert together", async ({ page }) => {
  await choose(page, [await pdf("a.pdf", [101, 102]), await pdf("b.pdf", [201])]);
  await expect(info(page)).toHaveText("Every page of these PDFs will be converted into a JPG file. 3 JPG will be created.");
  const { bytes } = await convertAndDownload(page);
  expect(Object.keys(unzipSync(bytes))).toEqual(["a_page-0001.jpg", "a_page-0002.jpg", "b_page-0001.jpg"]);
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to jpg - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await pdf("a-long-file-name-that-should-not-overflow.pdf", [101, 102]), await pdf("b.pdf", [450])]);
    await expect(panel(page).getByRole("heading", { name: "PDF to JPG options" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(3, { timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to jpg - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", [101, 102])]);
    await expect(page.getByTestId("pdf-jpg-card").locator("img")).toHaveCount(1);
    await choice(page, "High").check();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(2, { timeout: 20000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
