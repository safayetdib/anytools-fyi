import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const SCREENSHOT_DIR = "test-results/screenshots/redact-pdf";
const PAGE = "/redact-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A bank letter: the account number on page 1, nothing private on page 2.
async function statement(name = "statement.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.setTitle("Statement for Rahim Uddin");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([300, 400]);
  first.drawText("Dear Rahim Uddin,", { x: 30, y: 350, size: 12, font });
  first.drawText("Your account 4821-7730 is now open.", { x: 30, y: 320, size: 12, font });
  doc.addPage([300, 400]).drawText("Thank you for banking with us.", { x: 30, y: 350, size: 12, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Redact PDF", exact: true });
const panel = (page: Page) => page.getByTestId("redact-options");
const sheet = (page: Page, number = 1) => page.getByTestId("redact-page").nth(number - 1).locator(".redact-sheet");
const boxes = (page: Page) => page.getByTestId("redact-box");

async function open(page: Page, file?: Upload) {
  // Scrolling happens at once, so pages are measured where they end up.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.getByLabel("Select PDF file").setInputFiles(file ?? (await statement()));
  await expect(sheet(page).locator(".redact-page-image")).toBeVisible({ timeout: 15000 });
}

async function dragOn(page: Page, from: [number, number], to: [number, number]) {
  await sheet(page).evaluate((element, share) => {
    const rect = element.getBoundingClientRect();
    window.scrollBy({ top: rect.top + rect.height * share - window.innerHeight / 2, behavior: "instant" });
  }, (from[1] + to[1]) / 2);
  const box = (await sheet(page).boundingBox()) as { x: number; y: number; width: number; height: number };
  const point = ([x, y]: [number, number]) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  await page.mouse.move(point(from).x, point(from).y);
  await page.mouse.down();
  await page.mouse.move(point(to).x, point(to).y, { steps: 6 });
  await page.mouse.up();
}

async function redactAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

async function texts(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const { items } = await (await doc.getPage(number)).getTextContent();
    pages.push(items.map((item) => ("str" in item ? item.str : "")).join(""));
  }
  return pages;
}

async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const pdfPage = await doc.getPage(1);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await pdfPage.render({ canvas: canvas as never, viewport }).promise;
  return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
}

test("redact pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Redact PDF" })).toBeVisible();
  for (const heading of ["How to redact a PDF", "How redacting works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/redact-pdf.png");
});

test("redact pdf - found words are blacked out and gone from the file, other pages untouched", async ({ page }) => {
  await open(page);
  await expect(runButton(page)).toBeDisabled();
  await panel(page).getByLabel("Find words to black out").fill("4821-7730");
  await panel(page).getByRole("button", { name: "Mark all" }).click();
  await expect(panel(page).getByText("Marked 1 place.")).toBeVisible();
  await expect(boxes(page)).toHaveCount(1);
  await panel(page).getByLabel("Find words to black out").fill("rahim uddin");
  await panel(page).getByRole("button", { name: "Mark all" }).click();
  await expect(boxes(page)).toHaveCount(2);
  const { name, bytes } = await redactAndDownload(page);
  expect(name).toBe("statement_redacted.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("2 areas blacked out on 1 page of statement.pdf");
  const [first, second] = await texts(bytes);
  expect(first).toBe("");
  expect(second).toBe("Thank you for banking with us.");
  expect(Buffer.from(bytes).includes("Rahim")).toBe(false);
  expect((await PDFDocument.load(bytes)).getTitle()).toBeUndefined();
  // Where the account number was printed is solid black now.
  expect(await pixel(bytes, 140, 76)).toEqual([0, 0, 0]);
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("redact pdf - an area dragged on the page is blacked out", async ({ page }) => {
  await open(page);
  await dragOn(page, [0.05, 0.1], [0.6, 0.15]);
  await expect(boxes(page)).toHaveCount(1);
  await expect(panel(page).getByRole("status").last()).toHaveText("1 area marked.");
  const { bytes } = await redactAndDownload(page);
  expect(await pixel(bytes, 60, 50)).toEqual([0, 0, 0]);
  // The account line below the box is still there, as a picture.
  expect(await pixel(bytes, 250, 300)).toEqual([255, 255, 255]);
});

test("redact pdf - a missing word says so, and Undo and Clear all take boxes back", async ({ page }) => {
  await open(page);
  await panel(page).getByLabel("Find words to black out").fill("passport");
  await panel(page).getByRole("button", { name: "Mark all" }).click();
  await expect(panel(page).getByText('"passport" wasn\'t found.')).toBeVisible();
  await dragOn(page, [0.1, 0.1], [0.5, 0.2]);
  await dragOn(page, [0.1, 0.5], [0.5, 0.6]);
  await expect(boxes(page)).toHaveCount(2);
  await panel(page).getByRole("button", { name: "Undo" }).click();
  await expect(boxes(page)).toHaveCount(1);
  await panel(page).getByRole("button", { name: "Clear all" }).click();
  await expect(boxes(page)).toHaveCount(0);
  await expect(runButton(page)).toBeDisabled();
});

test("redact pdf - a box moves with the arrow keys and Delete removes it", async ({ page }) => {
  await open(page);
  await dragOn(page, [0.1, 0.1], [0.3, 0.2]);
  const marked = boxes(page).first();
  const before = await marked.boundingBox();
  await marked.focus();
  await marked.press("Shift+ArrowRight");
  expect(((await marked.boundingBox())?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(10);
  await marked.press("Delete");
  await expect(boxes(page)).toHaveCount(0);
});

for (const width of [320, 375, 768, 1366]) {
  test(`redact pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, await statement("a-long-file-name-that-should-not-overflow.pdf"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("redact pdf - pages scroll until Mark area is chosen", async ({ page }) => {
    await open(page);
    await expect(panel(page).getByRole("radio", { name: "Move" })).toBeChecked();
    await expect(sheet(page)).not.toHaveCSS("touch-action", "none");
    await panel(page).locator(".redact-mode").filter({ hasText: "Mark area" }).click();
    await expect(sheet(page)).toHaveCSS("touch-action", "none");
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`redact pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF file").setInputFiles(await statement());
    await expect(sheet(page).locator(".redact-page-image")).toBeVisible({ timeout: 15000 });
    await panel(page).getByLabel("Find words to black out").fill("4821");
    await panel(page).getByRole("button", { name: "Mark all" }).click();
    await expect(boxes(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
