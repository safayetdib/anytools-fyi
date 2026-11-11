import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const SCREENSHOT_DIR = "test-results/screenshots/grayscale-pdf";
const PAGE = "/grayscale-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A colour flyer: a red banner, blue text and a colour photo.
async function flyer(name = "flyer.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([300, 400]);
  page.drawRectangle({ x: 0, y: 340, width: 300, height: 60, color: rgb(0.8, 0.1, 0.1) });
  page.drawText("Grand Sale", { x: 20, y: 300, size: 24, font, color: rgb(0.1, 0.3, 0.9) });
  page.drawImage(await doc.embedJpg(await readFile("tests/fixtures/images/wide.jpg")), { x: 20, y: 60, width: 260, height: 144 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to grayscale", exact: true });
const cards = (page: Page) => page.getByTestId("gray-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// How many pixels of the first page still have colour, drawn at 1 pixel per point, and the page's text.
async function inspect(bytes: Uint8Array) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  const data = canvas.getContext("2d").getImageData(0, 0, viewport.width, viewport.height).data;
  let coloured = 0;
  for (let at = 0; at < data.length; at += 4) if (Math.max(data[at], data[at + 1], data[at + 2]) - Math.min(data[at], data[at + 1], data[at + 2]) > 16) coloured++;
  const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
  return { coloured, text };
}

test("grayscale pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Grayscale PDF" })).toBeVisible();
  for (const heading of ["How to make a PDF black and white", "How grayscale works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/grayscale-pdf.png");
});

test("grayscale pdf - shapes, text and photos all turn grey, and the text stays text", async ({ page }) => {
  const input = await flyer();
  expect((await inspect(new Uint8Array(input.buffer))).coloured).toBeGreaterThan(10000);
  await choose(page, [input]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("flyer_grayscale.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("flyer.pdf is now black and white.");
  const { coloured, text } = await inspect(bytes);
  expect(coloured).toBe(0);
  expect(text).toBe("Grand Sale");
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("grayscale pdf - several PDFs come in one ZIP", async ({ page }) => {
  await choose(page, [await flyer("a.pdf"), await flyer("b.pdf")]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_grayscale.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(["a_grayscale.pdf", "b_grayscale.pdf"]);
  expect((await inspect(files["b_grayscale.pdf"])).coloured).toBe(0);
});

for (const width of [320, 375, 768, 1366]) {
  test(`grayscale pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await flyer("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`grayscale pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await flyer()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
