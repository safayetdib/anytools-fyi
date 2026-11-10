import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/edit-pdf";
const PAGE = "/edit-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// Plain white pages, 300 by 400 points, so what's added is easy to find.
async function blankPdf(name = "form.pdf", pages = 2): Promise<Upload> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) doc.addPage([300, 400]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Apply changes", exact: true });
const panel = (page: Page) => page.getByTestId("edit-options");
const sheet = (page: Page, number = 1) => page.getByTestId("edit-page").nth(number - 1).locator(".edit-sheet");
const chooseTool = (page: Page, name: string) => panel(page).locator("label.edit-tool").filter({ hasText: name }).click();

async function open(page: Page, file: Upload = { name: "", mimeType: "", buffer: Buffer.alloc(0) }) {
  // Scrolling happens at once, so pages are measured where they end up.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.getByLabel("Select PDF file").setInputFiles(file.name ? file : await blankPdf());
  await expect(sheet(page)).not.toHaveClass(/is-loading/, { timeout: 15000 });
  await expect(sheet(page).locator(".edit-page-image")).toBeVisible();
}

// Scrolls so a height on a page (a share of it) is in the middle of the window, clear of the header and bottom bar.
async function bringIntoView(page: Page, y: number, number = 1) {
  await sheet(page, number).evaluate((element, share) => {
    const rect = element.getBoundingClientRect();
    window.scrollBy({ top: rect.top + rect.height * share - window.innerHeight / 2, behavior: "instant" });
  }, y);
}

// A point on a page, as shares of its width and height.
async function at(page: Page, x: number, y: number, number = 1) {
  const box = (await sheet(page, number).boundingBox()) as { x: number; y: number; width: number; height: number };
  return { x: box.x + box.width * x, y: box.y + box.height * y };
}

async function dragOn(page: Page, from: [number, number], to: [number, number]) {
  await bringIntoView(page, (from[1] + to[1]) / 2);
  const start = await at(page, ...from);
  const end = await at(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

async function applyAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

async function textOf(bytes: Uint8Array, number = 1) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pdfPage = await doc.getPage(number);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const { items } = await pdfPage.getTextContent();
  return items
    .filter((item) => "str" in item && item.str.trim())
    .map((item) => {
      const { str, transform } = item as { str: string; transform: number[] };
      const [x, y] = viewport.convertToViewportPoint(transform[4], transform[5]);
      return { text: str, x, y };
    });
}

// The colour of a point of a page as shown, at 1 pixel per point.
async function pixel(bytes: Uint8Array, x: number, y: number, number = 1) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pdfPage = await doc.getPage(number);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await pdfPage.render({ canvas: canvas as never, viewport }).promise;
  return [...canvas.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)];
}

// Thin lines land a fraction of a point apart in each browser, so their edge pixels are only mostly dark.
const isInk = (rgb: number[]) => rgb.every((value) => value < 120);

const imagesOn = async (bytes: Uint8Array, number = 1) => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(number - 1).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0;
};

test("edit pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Edit PDF" })).toBeVisible();
  for (const heading of ["How to edit a PDF", "How editing works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/edit-pdf.png");
});

test("edit pdf - typed text lands where it was placed, in the chosen size", async ({ page }) => {
  await open(page);
  await expect(runButton(page)).toBeDisabled();
  await chooseTool(page, "Text");
  await bringIntoView(page, 0.25);
  const spot = await at(page, 0.2, 0.25);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type("Paid in full");
  await expect(panel(page).getByRole("status")).toHaveText("1 change.");
  await expect(runButton(page)).toBeEnabled();
  const { name, bytes } = await applyAndDownload(page);
  expect(name).toBe("form_edited.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("1 change on 1 page of form.pdf");
  const [text] = await textOf(bytes);
  expect(text.text).toBe("Paid in full");
  // The tap marks the middle of the line: 60 points in and about 100 points down on a 300 by 400 page.
  expect(Math.abs(text.x - 60)).toBeLessThan(3);
  expect(Math.abs(text.y - 105)).toBeLessThan(6);
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/text-result.png` });
});

test("edit pdf - Bangla text goes in as a sharp picture", async ({ page }) => {
  await open(page);
  await chooseTool(page, "Text");
  await bringIntoView(page, 0.3);
  const spot = await at(page, 0.2, 0.3);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.insertText("পরিশোধিত");
  const { bytes } = await applyAndDownload(page);
  expect(await imagesOn(bytes)).toBe(1);
});

test("edit pdf - a rectangle, a highlight and whiteout are drawn where they were dragged", async ({ page }) => {
  // Black text-like bars to cover and to highlight.
  const doc = await PDFDocument.load(await makePdf([300], 400));
  const first = doc.getPage(0);
  const { rgb } = await import("pdf-lib");
  first.drawRectangle({ x: 30, y: 300, width: 200, height: 10, color: rgb(0, 0, 0) });
  await open(page, { name: "form.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) });
  await chooseTool(page, "Whiteout");
  // Covers the bar's left half: the bar is 90 to 100 points down.
  await dragOn(page, [0.08, 0.2], [0.4, 0.27]);
  await chooseTool(page, "Rectangle");
  await dragOn(page, [0.5, 0.5], [0.9, 0.7]);
  await chooseTool(page, "Highlight");
  await dragOn(page, [0.1, 0.8], [0.6, 0.85]);
  await expect(panel(page).getByRole("status")).toHaveText("3 changes.");
  const { bytes } = await applyAndDownload(page);
  // Under the whiteout, white; the bar beyond it, still black.
  expect(await pixel(bytes, 60, 95)).toEqual([255, 255, 255]);
  expect(await pixel(bytes, 200, 95)).toEqual([0, 0, 0]);
  // The rectangle's left edge, in black, the default colour, and its inside left clear.
  expect(isInk(await pixel(bytes, 150, 240))).toBe(true);
  expect(await pixel(bytes, 200, 240)).toEqual([255, 255, 255]);
  // The highlight is yellow over the white page.
  expect(await pixel(bytes, 90, 330)).toEqual([255, 225, 77]);
});

test("edit pdf - a picture goes on the page in view, as it is", async ({ page }) => {
  await open(page);
  await chooseTool(page, "Image");
  await panel(page).locator("[data-image-input]").setInputFiles("tests/fixtures/images/wide.jpg");
  await expect(sheet(page).locator(".edit-item.is-image img")).toBeVisible();
  const { bytes } = await applyAndDownload(page);
  expect(await imagesOn(bytes)).toBe(1);
  expect(Buffer.from(bytes).includes(await readFile("tests/fixtures/images/wide.jpg"))).toBe(true);
});

test("edit pdf - drawing makes a line of ink, and Undo takes it back", async ({ page }) => {
  await open(page);
  await chooseTool(page, "Draw");
  await dragOn(page, [0.2, 0.5], [0.8, 0.5]);
  await dragOn(page, [0.2, 0.7], [0.8, 0.7]);
  await expect(panel(page).getByRole("status")).toHaveText("2 changes.");
  await panel(page).getByRole("button", { name: "Undo" }).click();
  await expect(panel(page).getByRole("status")).toHaveText("1 change.");
  const { bytes } = await applyAndDownload(page);
  expect(isInk(await pixel(bytes, 150, 200))).toBe(true);
  expect(await pixel(bytes, 150, 280)).toEqual([255, 255, 255]);
});

test("edit pdf - a shape moves with the mouse and the arrow keys, and Delete removes it", async ({ page }) => {
  await open(page);
  await chooseTool(page, "Rectangle");
  await panel(page).getByLabel("Filled").check();
  await dragOn(page, [0.1, 0.1], [0.3, 0.2]);
  const item = sheet(page).getByTestId("edit-item");
  await expect(item).toHaveCount(1);
  // Drag it to the middle, then nudge it right with the keyboard.
  await dragOn(page, [0.2, 0.15], [0.5, 0.5]);
  await item.press("ArrowRight");
  const { bytes } = await applyAndDownload(page);
  // Its middle was 0.2, 0.15; dragged by 0.3 and 0.35, then 0.01 right: about 156 and 200 points.
  expect(await pixel(bytes, 156, 200)).toEqual([17, 17, 17]);
  expect(await pixel(bytes, 60, 60)).toEqual([255, 255, 255]);
});

test("edit pdf - a selected text changes colour and size from the panel", async ({ page }) => {
  await open(page);
  await chooseTool(page, "Text");
  await bringIntoView(page, 0.2);
  const spot = await at(page, 0.1, 0.2);
  await page.mouse.click(spot.x, spot.y);
  await page.keyboard.type("Draft");
  await panel(page).locator(".edit-swatch").filter({ has: page.getByRole("radio", { name: "Red" }) }).click();
  await expect(panel(page).getByRole("radio", { name: "Red" })).toBeChecked();
  await panel(page).getByLabel("Size").fill("30");
  await panel(page).getByLabel("Size").press("Tab");
  const { bytes } = await applyAndDownload(page);
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const { items } = await (await doc.getPage(1)).getTextContent();
  const [draft] = items as { str: string; transform: number[] }[];
  expect(draft.str).toBe("Draft");
  expect(Math.round(draft.transform[0])).toBe(30);
  // Red, from the panel's swatch.
  expect(await pixel(bytes, 33, 82)).toEqual(expect.arrayContaining([198]));
});

for (const width of [320, 375, 768, 1366]) {
  test(`edit pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, await blankPdf("a-long-file-name-that-should-not-overflow.pdf"));
    await chooseTool(page, "Text");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("edit pdf - a finger draws on the page instead of scrolling it", async ({ page }) => {
    await open(page);
    await chooseTool(page, "Draw");
    await expect(sheet(page)).toHaveCSS("touch-action", "none");
    await chooseTool(page, "Select");
    await expect(sheet(page)).not.toHaveCSS("touch-action", "none");
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`edit pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF file").setInputFiles(await blankPdf());
    await expect(sheet(page)).not.toHaveClass(/is-loading/, { timeout: 15000 });
    await chooseTool(page, "Rectangle");
    await dragOn(page, [0.1, 0.1], [0.4, 0.3]);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
