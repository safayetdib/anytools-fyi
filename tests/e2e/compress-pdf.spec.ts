import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/compress-pdf";
const PAGE = "/compress-pdf/";

const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("compress-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Compress PDF", exact: true });

// A large, detailed photo, made by the browser's own JPEG encoder like a phone camera would.
// Drawing and encoding this photo is the slowest part of these tests, so each test worker makes it once.
let photoBytes: Promise<Uint8Array> | undefined;

function photo(page: Page): Promise<Uint8Array> {
  photoBytes ??= makePhoto(page);
  return photoBytes;
}

async function makePhoto(page: Page): Promise<Uint8Array> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(2400, 3200);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    const sky = context.createLinearGradient(0, 0, 2400, 3200);
    sky.addColorStop(0, "#4a90c2");
    sky.addColorStop(1, "#f2c14e");
    context.fillStyle = sky;
    context.fillRect(0, 0, 2400, 3200);
    // Fine grain, like a real photo, so the camera's JPEG is big.
    const grain = context.getImageData(0, 0, 2400, 3200);
    let seed = 7;
    for (let i = 0; i < grain.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const shift = (seed >> 16) % 40;
      grain.data[i] += shift;
      grain.data[i + 1] += shift;
      grain.data[i + 2] += shift;
    }
    context.putImageData(grain, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    // Base64 crosses from the page far faster than a list of numbers.
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(",") + 1);
  });
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// A two-page report: a heading on each page and the photo filling most of it.
async function photoPdf(page: Page, name = "report.pdf") {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await photo(page));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 2; number++) {
    const sheet = doc.addPage([595, 842]);
    sheet.drawText(`Site visit, page ${number}`, { x: 50, y: 800, size: 20, font });
    sheet.drawImage(image, { x: 50, y: 60, width: 495, height: 660 });
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// A short text PDF saved the compact way, so there's nothing left to make smaller.
const textPdf = async (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await (await PDFDocument.load(await makePdf([300, 300], 400))).save()),
});

async function pageTexts(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const items = (await (await doc.getPage(number)).getTextContent()).items as { str: string }[];
    texts.push(items.map((item) => item.str).join(""));
  }
  await task.destroy();
  return texts;
}

async function compressAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 30000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("compress pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Compress PDF" })).toBeVisible();
  for (const heading of ["How to compress a PDF", "How compression works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.title()).toBe("Compress PDF Online Free, No Upload | AnyTools.fyi");
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/compress-pdf/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/compress-pdf.png");
});

test("compress pdf - the diagram shows each level", async ({ page }) => {
  await page.goto(PAGE);
  const diagram = page.locator("[data-squeeze-diagram]");
  await expect(diagram.getByText("2.1 MB")).toBeVisible();
  await diagram.getByRole("radio", { name: "Extreme" }).check();
  await expect(diagram.getByText("0.9 MB")).toBeVisible();
  await expect(diagram.locator("figcaption")).toContainText("Smallest file");
});

test("compress pdf - starts on Recommended, with each file's size", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await textPdf("a.pdf"), await textPdf("b.pdf")]);
  await expect(panel(page).getByRole("heading", { name: "Compression level" })).toBeVisible();
  for (const level of ["Extreme compression", "Recommended compression", "Less compression"]) {
    await expect(panel(page).getByRole("radio", { name: level })).toBeVisible();
  }
  await expect(panel(page).getByRole("radio", { name: "Recommended compression" })).toBeChecked();
  await expect(page.getByTestId("compress-card")).toHaveCount(2);
  await expect(page.getByTestId("compress-card").first()).toContainText(/a\.pdf\s*\d+(\.\d)? (B|KB)/);
  await expect(panel(page).getByText("Total size")).toBeVisible();
  await expect(page.getByTestId("compress-card").first().locator("img")).toBeVisible();
});

test("compress pdf - a PDF of photos gets smaller at every level, Extreme the most", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(PAGE);
  const file = await photoPdf(page);
  const sizes: Record<string, number> = {};
  for (const level of ["Less compression", "Recommended compression", "Extreme compression"]) {
    await page.goto(PAGE);
    await picker(page).setInputFiles([file]);
    await panel(page).getByRole("radio", { name: level }).check();
    const { name, bytes } = await compressAndDownload(page);
    expect(name).toBe("report_compressed.pdf");
    await expect(page.getByTestId("shell-result-card")).toContainText(/report\.pdf is now \d+% smaller: .+ to .+\./);
    expect(await pageTexts(bytes)).toEqual(["Site visit, page 1", "Site visit, page 2"]);
    sizes[level] = bytes.length;
  }
  expect(sizes["Less compression"]).toBeLessThan(file.buffer.length);
  expect(sizes["Recommended compression"]).toBeLessThan(sizes["Less compression"]);
  expect(sizes["Extreme compression"]).toBeLessThan(sizes["Recommended compression"]);
  expect(sizes["Recommended compression"]).toBeLessThan(file.buffer.length / 3);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png`, fullPage: true });
});

test("compress pdf - a PDF that is already small comes back unchanged", async ({ page }) => {
  await page.goto(PAGE);
  const file = await textPdf("letter.pdf");
  await picker(page).setInputFiles([file]);
  const { name, bytes } = await compressAndDownload(page);
  expect(name).toBe("letter_compressed.pdf");
  expect(Buffer.from(bytes).equals(file.buffer)).toBe(true);
  await expect(page.getByTestId("shell-result-card")).toContainText("letter.pdf is already well compressed");
});

test("compress pdf - several PDFs come in one ZIP, each labelled", async ({ page }) => {
  // Compressing two files with large photos takes a while when every test runs at once.
  test.slow();
  await page.goto(PAGE);
  await picker(page).setInputFiles([await photoPdf(page, "photos.pdf"), await textPdf("notes.pdf")]);
  const { name, bytes } = await compressAndDownload(page);
  expect(name).toBe("anytools_compressed.zip");
  expect(Object.keys(unzipSync(bytes))).toEqual(["photos_compressed.pdf", "notes_compressed.pdf"]);
  await expect(page.getByTestId("shell-result-card")).toContainText(/2 PDFs are \d+% smaller in total/);
  await expect(page.getByTestId("shell-part")).toHaveCount(2);
  await expect(page.getByTestId("shell-part").first()).toContainText(/photos_compressed\.pdf\s*\d+% smaller/);
  await expect(page.getByTestId("shell-part").last()).toContainText(/notes_compressed\.pdf\s*Already compressed/);
});

for (const width of [320, 375, 768, 1366]) {
  test(`compress pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await picker(page).setInputFiles([await textPdf("a-long-file-name-that-should-not-overflow.pdf")]);
    await expect(panel(page).getByRole("heading", { name: "Compression level" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Extreme compression", "Recommended compression", "Less compression"]) {
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
  test(`compress pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await textPdf("a.pdf"), await textPdf("b.pdf")]);
    await expect(page.getByTestId("compress-card").first().locator("img")).toBeVisible();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your 2 files are ready" })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
