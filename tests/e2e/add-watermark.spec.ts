import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/add-watermark";
const PAGE = "/add-watermark/";

const pdf = async (name: string, count: number) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(Array.from({ length: count }, () => 300), 400)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("watermark-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Add watermark", exact: true });
const marks = (page: Page) => page.getByTestId("watermark-mark");

// The text drawn on each page, read back the way a PDF reader sees it.
async function pageTexts(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const texts: string[][] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const items = (await (await doc.getPage(number)).getTextContent()).items as { str: string }[];
    texts.push(items.map((item) => item.str).filter((text) => text.trim()));
  }
  await task.destroy();
  return texts;
}

async function choose(page: Page, files: Awaited<ReturnType<typeof pdf>>[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(files);
  await expect(page.getByTestId("page-grid-item").first()).toBeVisible();
}

async function stampAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("add watermark - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Add watermark" })).toBeVisible();
  for (const heading of ["How to add a watermark to a PDF", "How watermarking works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/add-watermark/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/add-watermark.png");
});

test("add watermark - starts like other tools: text, top left, no transparency or rotation, over the content", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 3)]);
  await expect(panel(page).getByRole("heading", { name: "Watermark options" })).toBeVisible();
  await expect(panel(page).getByRole("radio", { name: "Place text" })).toBeChecked();
  await expect(panel(page).getByLabel("Text", { exact: true })).toHaveValue("CONFIDENTIAL");
  await expect(panel(page).getByRole("radio", { name: "Top left" })).toBeChecked();
  await expect(panel(page).getByLabel("Mosaic")).not.toBeChecked();
  await expect(panel(page).getByLabel("Transparency")).toHaveValue("0");
  await expect(panel(page).getByLabel("Rotation")).toHaveValue("0");
  await expect(panel(page).getByLabel("Watermark from page")).toHaveValue("1");
  await expect(panel(page).getByLabel("to page")).toHaveValue("3");
  await expect(panel(page).getByRole("radio", { name: "Over the PDF content" })).toBeChecked();
  await expect(marks(page)).toHaveText(["CONFIDENTIAL", "CONFIDENTIAL", "CONFIDENTIAL"]);
  await expect(marks(page).first()).toHaveAttribute("data-spot", "top-left");
});

test("add watermark - the preview follows the text, spot, rotation, transparency and mosaic", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 2)]);
  await panel(page).getByLabel("Text", { exact: true }).fill("DRAFT");
  await panel(page).getByRole("radio", { name: "Middle center" }).check();
  await panel(page).getByLabel("Rotation").selectOption("45");
  await panel(page).getByLabel("Transparency").selectOption("50");
  await expect(marks(page).first()).toHaveText("DRAFT");
  await expect(marks(page).first()).toHaveAttribute("data-spot", "middle-center");
  await expect(marks(page).first()).toHaveCSS("opacity", "0.5");
  await panel(page).getByLabel("Mosaic").check();
  expect(await page.getByTestId("page-grid-item").first().getByTestId("watermark-mark").count()).toBeGreaterThan(4);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/preview.png`, fullPage: true });
});

test("add watermark - the new file carries the text on the chosen pages, named like other tools", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 3)]);
  await panel(page).getByLabel("Text", { exact: true }).fill("DRAFT");
  await panel(page).getByLabel("Watermark from page").fill("2");
  await panel(page).getByLabel("Watermark from page").blur();
  const { name, bytes } = await stampAndDownload(page);
  expect(name).toBe("report_watermark.pdf");
  expect(await pageTexts(bytes)).toEqual([[], ["DRAFT"], ["DRAFT"]]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("add watermark - an image watermark is placed on each page", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 2)]);
  await panel(page).getByRole("radio", { name: "Place image" }).check();
  await expect(runButton(page)).toBeDisabled();
  await panel(page).getByLabel("Choose an image").setInputFiles("tests/fixtures/images/logo.png");
  await expect(marks(page).first().locator("img")).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
  const { bytes } = await stampAndDownload(page);
  const doc = await PDFDocument.load(bytes);
  for (const pdfPage of doc.getPages()) {
    expect(pdfPage.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)?.keys().length).toBe(1);
  }
});

test("add watermark - Bangla text is stamped as a sharp picture", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 2)]);
  await panel(page).getByLabel("Text", { exact: true }).fill("গোপনীয় নথি");
  await expect(runButton(page)).toBeEnabled();
  const { bytes } = await stampAndDownload(page);
  const doc = await PDFDocument.load(bytes);
  const refs = doc.getPages().flatMap((one) => {
    const images = one.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
    return images ? images.keys().map((key) => String(images.get(key))) : [];
  });
  // One picture, placed on both pages.
  expect(refs).toHaveLength(2);
  expect(new Set(refs).size).toBe(1);
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/screenshots/add-watermark/bangla-result.png" });
});

test("add watermark - several PDFs come in one ZIP", async ({ page }) => {
  await choose(page, [await pdf("a.pdf", 2), await pdf("b.pdf", 1)]);
  const { name, bytes } = await stampAndDownload(page);
  expect(name).toBe("anytools_watermark.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["a_watermark.pdf", "b_watermark.pdf"]);
  expect(await pageTexts(files["b_watermark.pdf"])).toEqual([["CONFIDENTIAL"]]);
});

for (const width of [320, 375, 768, 1366]) {
  test(`add watermark - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await pdf("a-long-file-name-that-should-not-overflow.pdf", 3)]);
    await expect(panel(page).getByRole("heading", { name: "Watermark options" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Place text", "Place image", "Over the PDF content", "Below the PDF content"]) {
      const label = panel(page).locator("label").filter({ hasText: name }).first();
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), name).toBe(true);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`add watermark - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", 2)]);
    await expect(page.getByTestId("page-grid").locator("img").first()).toBeVisible();
    await panel(page).getByLabel("Mosaic").check();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await panel(page).getByRole("radio", { name: "Place image" }).check();
    const { violations: image } = await new AxeBuilder({ page }).analyze();
    expect(image.map((v) => v.id)).toEqual([]);
    await panel(page).getByRole("radio", { name: "Place text" }).check();
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
