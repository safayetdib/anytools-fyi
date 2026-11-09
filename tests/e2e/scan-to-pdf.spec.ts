import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

const SCREENSHOT_DIR = "test-results/screenshots/scan-to-pdf";
const PAGE = "/scan-to-pdf/";

// A phone photo of a page: yellowed paper with a shadow across the right side, lines of text and a red stamp.
async function pagePhoto(page: Page, name = "page.jpg") {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(900, 1200);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    const light = context.createLinearGradient(0, 0, 900, 0);
    light.addColorStop(0, "#f0e2c0");
    light.addColorStop(1, "#8a7d62");
    context.fillStyle = light;
    context.fillRect(0, 0, 900, 1200);
    context.fillStyle = "rgba(20, 18, 14, 0.85)";
    for (let line = 0; line < 14; line++) context.fillRect(90, 150 + line * 50, 640 - (line % 3) * 90, 14);
    context.strokeStyle = "rgba(190, 40, 40, 0.9)";
    context.lineWidth = 10;
    context.beginPath();
    context.arc(650, 1000, 80, 0, Math.PI * 2);
    context.stroke();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    const url = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    return url.slice(url.indexOf(",") + 1);
  });
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

// The colour at a spot of a picture, as fractions across and down.
async function colourAt(page: Page, bytes: Uint8Array | Buffer, x: number, y: number, type = "image/jpeg") {
  return page.evaluate(
    async ({ data, x, y, type }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      context.drawImage(bitmap, 0, 0);
      return Array.from(context.getImageData(Math.floor(bitmap.width * x), Math.floor(bitmap.height * y), 1, 1).data.slice(0, 3));
    },
    { data: Array.from(bytes), x, y, type },
  );
}

// The picture placed on each page of a PDF: scans go in as JPGs.
async function pagePictures(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((one) => {
    const images = one.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict) as PDFDict;
    return (images.lookup(images.keys()[0]) as PDFRawStream).contents;
  });
}

const panel = (page: Page) => page.getByTestId("images-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Create PDF", exact: true });
const look = (page: Page, name: string) => panel(page).getByRole("radio", { name });

async function choose(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.getByLabel("Select photos of pages").setInputFiles(files);
  await expect(page.getByTestId("image-card").locator("img")).toHaveCount(files.length);
}

async function createAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 30000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("scan to pdf - page shows the working tool, its help, and links to JPG to PDF", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Scan to PDF" })).toBeVisible();
  for (const heading of ["How to scan a document to PDF with your phone", "How scanning works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/scan-to-pdf.png");
  await expect(page.locator('a[href="/jpg-to-pdf/"]').first()).toBeAttached();
  // A mouse and keyboard computer has no camera button: it only shows on phones and tablets.
  await expect(page.getByTestId("shell-camera")).toBeHidden();
});

test("scan to pdf - Colour whitens the paper and keeps the stamp red", async ({ page }) => {
  await page.goto(PAGE);
  const photo = await pagePhoto(page);
  await choose(page, [photo]);
  await expect(look(page, "Colour")).toBeChecked();
  // In the photo, the paper in the shadow is grey-brown.
  const before = await colourAt(page, photo.buffer, 0.95, 0.05);
  expect(Math.max(...before)).toBeLessThan(170);
  const { name, bytes } = await createAndDownload(page);
  expect(name).toBe("page.pdf");
  const [picture] = await pagePictures(bytes);
  for (const [x, y] of [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95]] as const) {
    expect(Math.min(...(await colourAt(page, picture, x, y)))).toBeGreaterThan(235);
  }
  // Text stays dark; the stamp's ring stays red.
  expect(Math.max(...(await colourAt(page, picture, 0.2, 0.131)))).toBeLessThan(90);
  const [r, g, b] = await colourAt(page, picture, 650 / 900, (1000 - 80) / 1200);
  expect(r).toBeGreaterThan(150);
  expect(r - Math.max(g, b)).toBeGreaterThan(60);
});

test("scan to pdf - Black and white makes grey pages, and the cards show the look", async ({ page }) => {
  await page.goto(PAGE);
  await choose(page, [await pagePhoto(page)]);
  // The top-right corner of the first card's picture, read straight from the image shown. Cards swap their picture
  // when the look changes, so each check is retried until it settles.
  const shown = () =>
    page.getByTestId("image-card").locator("img").first().evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      context.drawImage(img, 0, 0);
      return Array.from(context.getImageData(Math.floor(img.naturalWidth * 0.95), Math.floor(img.naturalHeight * 0.05), 1, 1).data.slice(0, 3));
    });
  await expect.poll(async () => Math.min(...(await shown()))).toBeGreaterThan(235);
  await look(page, "Original").check();
  await expect.poll(async () => Math.max(...(await shown()))).toBeLessThan(170);
  await look(page, "Black and white").check();
  await expect.poll(async () => Math.min(...(await shown()))).toBeGreaterThan(235);
  const [picture] = await pagePictures((await createAndDownload(page)).bytes);
  const [r, g, b] = await colourAt(page, picture, 650 / 900, (1000 - 80) / 1200);
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12);
});

test("scan to pdf - Original keeps the photo as it was", async ({ page }) => {
  await page.goto(PAGE);
  await choose(page, [await pagePhoto(page)]);
  await look(page, "Original").check();
  const [picture] = await pagePictures((await createAndDownload(page)).bytes);
  expect(Math.max(...(await colourAt(page, picture, 0.95, 0.05)))).toBeLessThan(170);
});

test("scan to pdf - several pages make one A4 PDF, in order", async ({ page }) => {
  await page.goto(PAGE);
  await choose(page, [await pagePhoto(page, "1.jpg"), await pagePhoto(page, "2.jpg"), await pagePhoto(page, "3.jpg")]);
  const { name, bytes } = await createAndDownload(page);
  expect(name).toBe("1.pdf");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(3);
  expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("scan to pdf - the camera button adds page after page", async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.getByTestId("shell-camera")).toBeVisible();
    await expect(page.getByTestId("shell-camera").locator("input")).toHaveAttribute("capture", "environment");
    await page.locator('[data-el="camera-input"]').setInputFiles([await pagePhoto(page, "first.jpg")]);
    await expect(page.getByTestId("image-card")).toHaveCount(1);
    // The bar at the bottom has its own camera button, for the next page.
    await expect(page.locator("label.shell-add.shell-camera")).toBeVisible();
    await page.locator('[data-el="camera-add-input"]').setInputFiles([await pagePhoto(page, "second.jpg")]);
    await expect(page.getByTestId("image-card")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/phone.png`, fullPage: true });
  });
});

for (const width of [320, 768, 1366]) {
  test(`scan to pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await choose(page, [await pagePhoto(page, "a-long-file-name-that-should-not-overflow.jpg"), await pagePhoto(page, "b.jpg")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`scan to pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await choose(page, [await pagePhoto(page)]);
    await look(page, "Black and white").check();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
