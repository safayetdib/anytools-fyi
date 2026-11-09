import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, rgb } from "pdf-lib";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-png";
const PAGE = "/pdf-to-png/";

const pdf = async (name: string, widths: number[], height = 300) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf(widths, height)) });

// One page with a small black box in the middle and nothing else, so the rest of the page is empty paper.
async function boxPdf(name = "stamp.pdf") {
  const doc = await PDFDocument.create();
  doc.addPage([200, 100]).drawRectangle({ x: 80, y: 30, width: 40, height: 40, color: rgb(0, 0, 0) });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("pdf-jpg-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Convert to PNG", exact: true });
const choice = (page: Page, name: string) => panel(page).getByRole("radio", { name: new RegExp(`^${name}`) });
const info = (page: Page) => page.getByTestId("pdf-jpg-info");

async function choose(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
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

// Width, height and the alpha of the corner and centre pixels, read in the page.
async function pixelsOf(page: Page, bytes: Uint8Array) {
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: "image/png" }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
    return { width: bitmap.width, height: bitmap.height, corner: at(2, 2), centre: at(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2)) };
  }, Array.from(bytes));
}

const isPng = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

test("pdf to png - page shows the working tool, its help and links to PDF to JPG", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to PNG" })).toBeVisible();
  for (const heading of ["How to convert PDF to PNG", "How converting works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/pdf-to-png/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-png.png");
  await expect(page.locator(`a[href="/pdf-to-jpg/"]`).first()).toBeAttached();
  await expect(page.getByText("Page to PNG: each of the 3 pages")).toBeVisible();
});

test("pdf to png - starts on Page to PNG, Normal and a white background, with the count", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", [101, 102, 103])]);
  await expect(panel(page).getByRole("heading", { name: "PDF to PNG options" })).toBeVisible();
  await expect(choice(page, "Page to PNG")).toBeChecked();
  await expect(choice(page, "Normal")).toBeChecked();
  await expect(choice(page, "White")).toBeChecked();
  await expect(info(page)).toHaveText("Every page of this PDF will be converted into a PNG file. 3 PNG will be created.");
  // The background only applies to whole pages.
  await choice(page, "Extract images").check();
  await expect(panel(page).getByRole("group", { name: "Page background" })).toBeHidden();
  await choice(page, "Page to PNG").check();
  await expect(panel(page).getByRole("group", { name: "Page background" })).toBeVisible();
});

test("pdf to png - pages become PNGs in a ZIP, named in order", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", [200, 300])]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pages-to-png.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["report_page-0001.png", "report_page-0002.png"]);
  for (const file of Object.values(files)) expect(isPng(file)).toBe(true);
  // 150 dpi: a page 200 points wide becomes 417 pixels.
  expect((await pixelsOf(page, files["report_page-0001.png"])).width).toBe(417);
  await expect(page.getByTestId("shell-part")).toHaveCount(2);
});

test("pdf to png - white keeps the paper, transparent leaves it out", async ({ page }) => {
  await choose(page, [await boxPdf()]);
  const white = await convertAndDownload(page);
  expect(white.name).toBe("stamp_page-0001.png");
  const solid = await pixelsOf(page, white.bytes);
  expect(solid.corner).toEqual([255, 255, 255, 255]);
  expect(solid.centre[3]).toBe(255);

  await choose(page, [await boxPdf()]);
  await choice(page, "Transparent").check();
  const clear = await convertAndDownload(page);
  const see = await pixelsOf(page, clear.bytes);
  expect(see.corner[3]).toBe(0);
  expect(see.centre.slice(0, 3)).toEqual([0, 0, 0]);
  expect(see.centre[3]).toBe(255);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/transparent-result.png`, fullPage: true });
});

test("pdf to png - extract images keeps a PNG logo's see-through parts", async ({ page }) => {
  const doc = await PDFDocument.create();
  const logo = await doc.embedPng(await readFile("tests/fixtures/images/logo.png"));
  doc.addPage([300, 300]).drawImage(logo, { x: 50, y: 50, width: 200, height: 200 });
  await choose(page, [{ name: "logo.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) }]);
  await choice(page, "Extract images").check();
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("logo_image-0001.png");
  expect(isPng(bytes)).toBe(true);
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to png - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await pdf("a-long-file-name-that-should-not-overflow.pdf", [101, 102]), await pdf("b.pdf", [450])]);
    await expect(panel(page).getByRole("heading", { name: "PDF to PNG options" })).toBeInViewport();
    await choice(page, "Transparent").check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(3, { timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to png - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", [101, 102])]);
    await expect(page.getByTestId("pdf-jpg-card").locator("img")).toHaveCount(1);
    await choice(page, "Transparent").check();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(2, { timeout: 20000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
