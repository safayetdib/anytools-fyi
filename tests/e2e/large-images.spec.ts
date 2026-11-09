import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "../fixtures/pdf";

// Very large pictures, like phone photos and print-ready logos, mustn't stretch any tool's layout.

const WIDTHS = [375, 1366];

// A big picture made by the browser's own encoder, like a camera or design app would.
async function bigImage(page: Page, width: number, height: number, type: "image/png" | "image/jpeg") {
  const bytes = await page.evaluate(
    async ({ width, height, type }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      const fill = context.createLinearGradient(0, 0, width, height);
      fill.addColorStop(0, "#1f6f4a");
      fill.addColorStop(1, "#f2c14e");
      context.fillStyle = fill;
      context.fillRect(0, 0, width, height);
      const blob = await canvas.convertToBlob({ type, quality: 0.9 });
      // Base64 crosses back to the test far faster than an array of numbers.
      const reader = new FileReader();
      return await new Promise<string>((resolve) => {
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.readAsDataURL(blob);
      });
    },
    { width, height, type },
  );
  return Buffer.from(bytes, "base64");
}

async function imagePdf(page: Page, name: string) {
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(await bigImage(page, 5000, 3500, "image/jpeg"));
  doc.addPage([842, 595]).drawImage(image, { x: 0, y: 0, width: 842, height: 595 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function expectNoSidewaysScroll(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

// Every picture on the page stays inside the screen.
async function expectImagesInside(page: Page, width: number) {
  const widest = await page.evaluate(() =>
    Math.max(0, ...Array.from(document.querySelectorAll("main img")).map((img) => img.getBoundingClientRect().right)),
  );
  expect(widest).toBeLessThanOrEqual(width);
}

for (const width of WIDTHS) {
  test(`large images - a big watermark logo stays a small thumbnail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/add-watermark/");
    const logo = await bigImage(page, 4000, 3000, "image/png");
    await page.getByLabel("Select PDF files").setInputFiles([{ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([400, 400], 560)) }]);
    const panel = page.getByTestId("watermark-options");
    await panel.getByRole("radio", { name: "Place image" }).check();
    await panel.getByLabel("Choose an image").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
    const thumbnail = panel.locator("[data-image-preview] img");
    await expect(thumbnail).toBeVisible();
    const box = (await thumbnail.boundingBox()) as { width: number; height: number };
    expect(box.width).toBeLessThanOrEqual(64);
    expect(box.height).toBeLessThanOrEqual(40);
    const panelBox = (await panel.locator("aside").first().boundingBox()) as { x: number; width: number };
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
    if (width >= 900) expect(panelBox.width).toBeLessThanOrEqual(23 * 16 + 1);
    await expectNoSidewaysScroll(page, width);
    await expectImagesInside(page, width);
    await page.screenshot({ path: `test-results/screenshots/large-images/watermark-${width}.png` });
  });

  test(`large images - a big photo in JPG to PDF keeps the layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/jpg-to-pdf/");
    const photo = await bigImage(page, 6000, 4000, "image/jpeg");
    await page.getByLabel("Select images").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(page.getByTestId("image-card").locator("img")).toBeVisible();
    await expectNoSidewaysScroll(page, width);
    await expectImagesInside(page, width);
    await page.getByRole("button", { name: "Convert to PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    await expectNoSidewaysScroll(page, width);
    await expectImagesInside(page, width);
  });

  test(`large images - extracting a big photo keeps the result cards in place at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pdf-to-jpg/");
    await page.getByLabel("Select PDF files").setInputFiles([await imagePdf(page, "a.pdf"), await imagePdf(page, "b.pdf")]);
    await page.getByTestId("pdf-jpg-options").getByRole("radio", { name: /^Extract images/ }).check();
    await page.getByRole("button", { name: "Convert to JPG", exact: true }).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(2, { timeout: 30000 });
    await expect(page.getByTestId("shell-part").first().locator("img")).toBeVisible();
    await expectNoSidewaysScroll(page, width);
    await expectImagesInside(page, width);
  });

  test(`large images - compressing a PDF with a big photo keeps the layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/compress-pdf/");
    await page.getByLabel("Select PDF files").setInputFiles([await imagePdf(page, "scan.pdf")]);
    await expect(page.getByTestId("compress-card").locator("img")).toBeVisible();
    await expectNoSidewaysScroll(page, width);
    await page.getByRole("button", { name: "Compress PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 30000 });
    await expectNoSidewaysScroll(page, width);
    await expectImagesInside(page, width);
  });
}
