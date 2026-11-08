import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { makePdf, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/extract-pdf-pages";
const PAGE = "/extract-pdf-pages/";

// Page widths double as labels, so each page can be told apart in the results.
const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select a PDF file");
const runButton = (page: Page) => page.getByRole("button", { name: "Extract pages", exact: true });
const tab = (page: Page, name: "Range" | "Pages" | "Size") => page.getByRole("radio", { name, exact: true });
const choice = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const info = (page: Page) => page.getByTestId("split-info");

async function choose(page: Page, widths: number[], name = "report.pdf") {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf(name, widths)]);
  await expect(page.getByTestId("page-grid-item")).toHaveCount(widths.length);
}

async function extractAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("extract pages - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Extract PDF pages" })).toBeVisible();
  await expect(picker(page)).toBeAttached();
  for (const heading of ["How to extract pages from a PDF", "How extracting pages works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
});

test("extract pages - opens on Pages and Extract all pages, like other PDF tools", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await expect(tab(page, "Pages")).toBeChecked();
  await expect(choice(page, "Extract all pages")).toBeChecked();
  await expect(info(page)).toContainText("4 PDFs will be created.");
  await expect(runButton(page)).toBeEnabled();
});

test("extract pages - every page becomes its own PDF in a ZIP", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  const { name, bytes } = await extractAndDownload(page);
  expect(name).toBe("report-split.zip");
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files)).toEqual(["report-1.pdf", "report-2.pdf", "report-3.pdf"]);
  expect(await pageWidths(files["report-2.pdf"])).toEqual([102]);
});

test("extract pages - chosen pages merged into one PDF, in page order", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105, 106]);
  await choice(page, "Select pages").check();
  await page.getByLabel("Pages to extract").fill("5,2-3");
  await page.getByLabel("Merge extracted pages into one PDF file").check();
  const { name, bytes } = await extractAndDownload(page);
  expect(name).toBe("report-extracted.pdf");
  expect(await pageWidths(bytes)).toEqual([102, 103, 105]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("extract pages - the other split choices are still there", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await tab(page, "Range").check();
  await expect(choice(page, "Custom")).toBeChecked();
  await tab(page, "Size").check();
  await expect(page.getByLabel("Maximum size per file")).toBeVisible();
});

for (const width of [320, 375, 768, 1366]) {
  test(`extract pages - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [101, 102, 103, 104, 105]);
    await expect(page.getByTestId("split-options").getByRole("heading", { name: "Split", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(5, { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`extract pages - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("report.pdf", [101, 102, 103])]);
    await expect(page.getByTestId("page-grid").locator("img").first()).toBeVisible();
    await choice(page, "Select pages").check();
    await page.getByRole("button", { name: "Page 2", exact: true }).click();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
