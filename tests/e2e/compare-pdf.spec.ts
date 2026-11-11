import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const SCREENSHOT_DIR = "test-results/screenshots/compare-pdf";
const PAGE = "/compare-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A lease, one line per clause, so a changed word is easy to find on the page.
async function lease(name: string, clauses: string[]): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 400]);
  clauses.forEach((clause, index) => page.drawText(clause, { x: 30, y: 350 - index * 24, size: 12, font }));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const original = () => lease("lease.pdf", ["Rent is due on the first day.", "The deposit is two months.", "Pets are not allowed."]);
const changed = () => lease("lease-v2.pdf", ["Rent is due on the fifth day.", "The deposit is two months.", "Pets are allowed."]);

const runButton = (page: Page) => page.getByRole("button", { name: "Compare PDF", exact: true });
const cards = (page: Page) => page.getByTestId("compare-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function compareAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// The colour of a point on the first sheet, at 1 pixel per point.
async function pixel(bytes: Uint8Array, x: number, y: number) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  return [...canvas.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
}

test("compare pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Compare PDF" })).toBeVisible();
  for (const heading of ["How to compare two PDFs", "How comparing works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/compare-pdf.png");
});

test("compare pdf - changed words are highlighted on the pages side by side", async ({ page }) => {
  await choose(page, [await original(), await changed()]);
  await expect(cards(page).first()).toContainText("Original");
  await expect(cards(page).nth(1)).toContainText("Changed");
  const { name, bytes } = await compareAndDownload(page);
  expect(name).toBe("lease-v2_compared.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("2 words removed and 1 word added");
  // One sheet: two 300-point pages with 24-point margins and a 24-point gap.
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPages().map((one) => [one.getWidth(), one.getHeight()])).toEqual([[672, 470]]);
  // "first" on the original (left) is red; "fifth" on the changed one (right) is green; "deposit" is untouched.
  const [red] = [await pixel(bytes, 24 + 130, 24 + 22 + 47)];
  expect(red[0]).toBeGreaterThan(red[1] + 60);
  const green = await pixel(bytes, 24 + 300 + 24 + 130, 24 + 22 + 47);
  expect(green[1]).toBeGreaterThan(green[0] + 60);
  const plain = await pixel(bytes, 24 + 120, 24 + 22 + 70);
  expect(Math.max(...plain) - Math.min(...plain)).toBeLessThan(15);
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("compare pdf - the same words in both say so", async ({ page }) => {
  await choose(page, [await original(), await lease("copy.pdf", ["Rent is due on the first day.", "The deposit is two months.", "Pets are not allowed."])]);
  await compareAndDownload(page);
  await expect(page.getByTestId("shell-result-card")).toContainText("The words are the same in both PDFs.");
});

test("compare pdf - one file asks for the second, and a third isn't compared", async ({ page }) => {
  await choose(page, [await original()]);
  await expect(page.getByTestId("compare-options").getByText("Add the changed version to compare with.")).toBeVisible();
  await choose(page, [await original(), await changed(), await lease("third.pdf", ["Third."])]);
  await expect(cards(page).nth(2)).toContainText("Not compared");
  await expect(page.getByTestId("compare-options").getByText("Choose exactly two PDFs")).toBeVisible();
  await expect(runButton(page)).toBeDisabled();
});

for (const width of [320, 375, 768, 1366]) {
  test(`compare pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await lease("a-long-file-name-that-should-not-overflow.pdf", ["One."]), await lease("b.pdf", ["Two."])]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`compare pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await original(), await changed()]);
    await expect(cards(page)).toHaveCount(2);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
