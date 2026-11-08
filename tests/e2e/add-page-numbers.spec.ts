import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/add-page-numbers";
const PAGE = "/add-page-numbers/";

const pdf = async (name: string, count: number) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(Array.from({ length: count }, () => 300), 400)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("numbers-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Add page numbers", exact: true });
const marks = (page: Page) => page.getByTestId("number-mark");

// The text drawn on each page, read back the way a PDF reader sees it.
async function pageTexts(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const items = (await (await doc.getPage(number)).getTextContent()).items as { str: string }[];
    texts.push(items.map((item) => item.str).filter((text) => text.trim()).join(" "));
  }
  await task.destroy();
  return texts;
}

async function choose(page: Page, files: Awaited<ReturnType<typeof pdf>>[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(files);
  await expect(page.getByTestId("page-grid-item").first()).toBeVisible();
}

async function numberAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("add page numbers - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Add page numbers" })).toBeVisible();
  for (const heading of ["How to add page numbers to a PDF", "How page numbering works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/add-page-numbers/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/add-page-numbers.png");
});

test("add page numbers - starts like other tools, with every page's number shown at the bottom right", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 3)]);
  await expect(panel(page).getByRole("heading", { name: "Page number options" })).toBeVisible();
  await expect(panel(page).getByRole("radio", { name: "Single page" })).toBeChecked();
  await expect(panel(page).getByRole("radio", { name: "Bottom right" })).toBeChecked();
  await expect(panel(page).getByLabel("Margin")).toHaveValue("recommended");
  await expect(panel(page).getByLabel("First number")).toHaveValue("1");
  await expect(panel(page).getByLabel("Number from page")).toHaveValue("1");
  await expect(panel(page).getByLabel("to page")).toHaveValue("3");
  await expect(panel(page).getByLabel("Text", { exact: true })).toHaveValue("number");
  await expect(marks(page)).toHaveText(["1", "2", "3"]);
  await expect(marks(page).first()).toHaveAttribute("data-spot", "bottom-right");
});

test("add page numbers - the preview follows the text, range and position", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 4)]);
  await panel(page).getByLabel("Text", { exact: true }).selectOption("pageOf");
  await panel(page).getByLabel("Number from page").fill("2");
  await panel(page).getByLabel("Number from page").blur();
  await expect(marks(page)).toHaveText(["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"]);
  await panel(page).getByRole("radio", { name: "Top center" }).check();
  await expect(marks(page).first()).toHaveAttribute("data-spot", "top-center");
  await panel(page).getByLabel("Text", { exact: true }).selectOption("custom");
  await panel(page).getByLabel("Custom text").fill("Sheet {n}");
  await expect(marks(page).first()).toHaveText("Sheet 1");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/preview.png`, fullPage: true });
});

test("add page numbers - the new file has the numbers as text, named like other tools", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 3)]);
  await panel(page).getByLabel("First number").fill("5");
  await panel(page).getByLabel("Text", { exact: true }).selectOption("page");
  const { name, bytes } = await numberAndDownload(page);
  expect(name).toBe("report_pagenumber.pdf");
  expect(await pageTexts(bytes)).toEqual(["Page 5", "Page 6", "Page 7"]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("add page numbers - facing pages mirror the numbers, and a cover page shifts them", async ({ page }) => {
  await choose(page, [await pdf("book.pdf", 4)]);
  await panel(page).getByRole("radio", { name: "Facing pages" }).check();
  await expect(marks(page).nth(0)).toHaveAttribute("data-spot", "bottom-left");
  await expect(marks(page).nth(1)).toHaveAttribute("data-spot", "bottom-right");
  await panel(page).getByLabel("First page is cover page").check();
  await expect(marks(page).nth(0)).toHaveAttribute("data-spot", "bottom-right");
  await expect(marks(page).nth(1)).toHaveAttribute("data-spot", "bottom-left");
});

test("add page numbers - text the fonts can't draw is explained before running", async ({ page }) => {
  await choose(page, [await pdf("report.pdf", 2)]);
  await panel(page).getByLabel("Text", { exact: true }).selectOption("custom");
  await panel(page).getByLabel("Custom text").fill("পৃষ্ঠা {n}");
  await expect(page.getByTestId("numbers-error")).toContainText("can only use Latin letters");
  await expect(runButton(page)).toBeDisabled();
});

test("add page numbers - several PDFs come in one ZIP, each numbered from its own start", async ({ page }) => {
  await choose(page, [await pdf("a.pdf", 2), await pdf("b.pdf", 3)]);
  const { name, bytes } = await numberAndDownload(page);
  expect(name).toBe("anytools_page-numbers.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["a_pagenumber.pdf", "b_pagenumber.pdf"]);
  expect(await pageTexts(files["b_pagenumber.pdf"])).toEqual(["1", "2", "3"]);
});

for (const width of [320, 375, 768, 1366]) {
  test(`add page numbers - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await pdf("a-long-file-name-that-should-not-overflow.pdf", 3)]);
    await expect(panel(page).getByRole("heading", { name: "Page number options" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Single page", "Facing pages"]) {
      const label = panel(page).locator("label").filter({ hasText: name }).first();
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth), name).toBe(true);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`add page numbers - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", 2)]);
    await expect(page.getByTestId("page-grid").locator("img").first()).toBeVisible();
    await panel(page).getByRole("radio", { name: "Facing pages" }).check();
    await panel(page).getByLabel("Bold").check();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
