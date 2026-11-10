import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/crop-pdf";
const PAGE = "/crop-pdf/";
// 72 points to the inch, 25.4 mm to the inch.
const MM = 72 / 25.4;

const pdf = async (name: string, widths: number[], height = 300) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf(widths, height)) });

// A 400 by 300 point page with a black block from (100, 75) to (300, 225), so its margins are 100 and 75 points.
async function blockPdf(turn = 0) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < 2; index++) {
    const page = doc.addPage([400, 300]);
    page.drawRectangle({ x: 100, y: 75, width: 200, height: 150, color: rgb(0, 0, 0) });
    if (turn) page.setRotation(degrees(turn));
  }
  return { name: "block.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const panel = (page: Page) => page.getByTestId("crop-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Crop PDF", exact: true });
const margin = (page: Page, side: string) => panel(page).getByRole("spinbutton", { name: side });
const box = (page: Page) => page.getByTestId("crop-box");

async function choose(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  // No smooth scrolling, so the page stays put while handles are measured.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.getByLabel("Select PDF file").setInputFiles([file]);
  await expect(box(page)).toBeVisible();
}

async function cropAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your file is ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  const doc = await PDFDocument.load(await readFile(await download.path()));
  return { name: download.suggestedFilename(), boxes: doc.getPages().map((one) => one.getMediaBox()), crops: doc.getPages().map((one) => one.getCropBox()) };
}

const near = (actual: { x: number; y: number; width: number; height: number }, expected: typeof actual, within = 1.5) => {
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(within);
};

test("crop pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Crop PDF" })).toBeVisible();
  for (const heading of ["How to crop a PDF", "How cropping works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/crop-pdf.png");
});

test("crop pdf - opens the first page with the box around it, and waits for a crop", async ({ page }) => {
  await choose(page, await pdf("report.pdf", [200, 200, 200]));
  await expect(page.getByTestId("crop-page-status")).toHaveText("Page 1 of 3");
  await expect(panel(page).getByRole("radio", { name: /^All pages/ })).toBeChecked();
  await expect(page.getByTestId("crop-status")).toHaveText("Nothing cropped yet. Drag the box's edges inwards.");
  await expect(runButton(page)).toBeDisabled();
  for (const side of ["Top", "Bottom", "Left", "Right"]) await expect(margin(page, side)).toHaveValue("0");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("crop-page-status")).toHaveText("Page 2 of 3");
  await expect(page.getByRole("button", { name: "Previous page" })).toBeEnabled();
});

test("crop pdf - dragging a corner handle crops every page the same way", async ({ page }) => {
  await choose(page, await pdf("report.pdf", [400, 400], 300));
  // The whole page fits above the bottom bar.
  const bar = await page.getByTestId("shell-action-bar").boundingBox();
  const sheet = await page.getByTestId("crop-sheet").boundingBox();
  if (bar && sheet) expect(sheet.y + sheet.height).toBeLessThanOrEqual(bar.y);
  if (!sheet) throw new Error("No page");
  const handle = box(page).locator('[data-handle="se"]');
  const start = await handle.boundingBox();
  if (!start) throw new Error("No handle");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("crop-status")).toHaveText("Every page will be cropped to the box.");
  await expect(runButton(page)).toBeEnabled();
  // Half the page is cut from the right and the bottom: 200 by 150 points.
  expect(Number(await margin(page, "Right").inputValue())).toBeCloseTo(200 / MM, -0.5);
  const { name, boxes, crops } = await cropAndDownload(page);
  expect(name).toBe("report_cropped.pdf");
  for (const area of [...boxes, ...crops]) near(area, { x: 0, y: 150, width: 200, height: 150 }, 4);
});

test("crop pdf - margins in millimetres crop exactly", async ({ page }) => {
  await choose(page, await pdf("report.pdf", [400, 400], 300));
  await margin(page, "Top").fill("10");
  await margin(page, "Left").fill("20");
  await expect(runButton(page)).toBeEnabled();
  const { boxes } = await cropAndDownload(page);
  for (const area of boxes) near(area, { x: 20 * MM, y: 0, width: 400 - 20 * MM, height: 300 - 10 * MM }, 0.5);
});

test("crop pdf - Current page crops only the pages you change", async ({ page }) => {
  await choose(page, await pdf("report.pdf", [400, 400, 400], 300));
  await panel(page).getByRole("radio", { name: /^Current page/ }).check();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("crop-page-status")).toHaveText("Page 2 of 3");
  await margin(page, "Bottom").fill("50");
  await expect(page.getByTestId("crop-status")).toHaveText("1 page will be cropped.");
  // Page 1 still shows its whole page.
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(margin(page, "Bottom")).toHaveValue("0");
  const { boxes } = await cropAndDownload(page);
  near(boxes[0], { x: 0, y: 0, width: 400, height: 300 }, 0.01);
  near(boxes[1], { x: 0, y: 50 * MM, width: 400, height: 300 - 50 * MM }, 0.5);
  near(boxes[2], { x: 0, y: 0, width: 400, height: 300 }, 0.01);
});

test("crop pdf - Fit to content trims the blank margins", async ({ page }) => {
  await choose(page, await blockPdf());
  await panel(page).getByRole("button", { name: "Fit to content" }).click();
  await expect(runButton(page)).toBeEnabled();
  const { boxes } = await cropAndDownload(page);
  // The block is 200 by 150 points; Fit leaves about 1% of the page around it.
  for (const area of boxes) near(area, { x: 96, y: 72, width: 208, height: 156 }, 7);
});

test("crop pdf - a sideways page crops the part you see", async ({ page }) => {
  await choose(page, await blockPdf(90));
  // Shown turned clockwise: 300 wide and 400 tall. The page's own left edge is at the top, so 100 points come off its left.
  await margin(page, "Top").fill(String(Math.round((100 / MM) * 10) / 10));
  const { boxes } = await cropAndDownload(page);
  near(boxes[0], { x: 100, y: 0, width: 300, height: 300 }, 0.5);
});

test("crop pdf - the box moves and resizes with the keyboard", async ({ page }) => {
  await choose(page, await pdf("report.pdf", [400], 300));
  await box(page).focus();
  for (let step = 0; step < 10; step++) await page.keyboard.press("Shift+ArrowLeft");
  for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowRight");
  await expect(box(page)).toHaveAttribute("aria-label", /Cutting 0 mm from the top/);
  expect(Number(await margin(page, "Left").inputValue())).toBeGreaterThan(5);
  expect(Number(await margin(page, "Right").inputValue())).toBeGreaterThan(5);
  await panel(page).getByRole("button", { name: "Reset" }).click();
  await expect(runButton(page)).toBeDisabled();
});

for (const width of [320, 375, 768, 1366]) {
  test(`crop pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, await pdf("a-long-file-name-that-should-not-overflow.pdf", [400, 200], 300));
    await margin(page, "Top").fill("20");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: /^Your file is ready$/ })).toBeVisible({ timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`crop pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF file").setInputFiles([await pdf("a.pdf", [200, 200])]);
    await expect(box(page)).toBeVisible();
    await margin(page, "Top").fill("10");
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
