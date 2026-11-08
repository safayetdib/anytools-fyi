import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeEncryptedPdf, makePdf, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/remove-pdf-pages";
const PAGE = "/remove-pdf-pages/";

// Page widths double as labels, so each page can be told apart in the result.
const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select a PDF file");
const runButton = (page: Page) => page.getByRole("button", { name: "Remove pages", exact: true });
const pagesBox = (page: Page) => page.getByLabel("Pages to remove");
const pageButton = (page: Page, number: number) => page.getByRole("button", { name: `Page ${number}`, exact: true });
const marked = (page: Page) =>
  page.getByTestId("page-grid").locator('button[aria-pressed="true"]').evaluateAll((buttons) => buttons.map((b) => Number((b as HTMLElement).dataset.page)));

async function choose(page: Page, widths: number[], name = "report.pdf") {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf(name, widths)]);
  await expect(page.getByTestId("page-grid-item")).toHaveCount(widths.length);
}

async function removeAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("remove pages - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Remove PDF pages" })).toBeVisible();
  await expect(picker(page)).toBeAttached();
  for (const heading of ["How to remove pages from a PDF", "How removing pages works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
});

test("remove pages - starts like other tools: every page, the total, an empty box and the button off", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  const panel = page.getByTestId("remove-options");
  await expect(panel.getByRole("heading", { name: "Remove pages" })).toBeVisible();
  await expect(panel).toContainText("Select the pages you want to remove. Hold Shift to select a range.");
  await expect(panel).toContainText("Total pages: 4");
  await expect(pagesBox(page)).toHaveValue("");
  await expect(pagesBox(page)).toHaveAttribute("placeholder", "example: 1,5-8");
  await expect(runButton(page)).toBeDisabled();
  expect(await marked(page)).toEqual([]);
});

test("remove pages - tapping marks and unmarks pages, and the box follows", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105, 106, 107]);
  await pageButton(page, 2).click();
  await pageButton(page, 5).click();
  await pageButton(page, 6).click();
  await expect(pagesBox(page)).toHaveValue("2,5-6");
  await expect(pageButton(page, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(runButton(page)).toBeEnabled();
  await pageButton(page, 5).click();
  await expect(pagesBox(page)).toHaveValue("2,6");
  await expect(pageButton(page, 5)).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/marked.png`, fullPage: true });
});

test("remove pages - Shift marks every page between the last tap and this one", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105, 106, 107, 108]);
  await pageButton(page, 2).click();
  await pageButton(page, 6).click({ modifiers: ["Shift"] });
  await expect(pagesBox(page)).toHaveValue("2-6");
  expect(await marked(page)).toEqual([2, 3, 4, 5, 6]);
});

test("remove pages - typing marks and unmarks pages, keeping only digits, commas and dashes", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  await pagesBox(page).fill("1,3-4");
  expect(await marked(page)).toEqual([1, 3, 4]);
  await pagesBox(page).fill("8-");
  expect(await marked(page)).toEqual([8, 9, 10]);
  await pagesBox(page).pressSequentially(",a2b");
  await expect(pagesBox(page)).toHaveValue("8-,2");
  expect(await marked(page)).toEqual([2, 8, 9, 10]);
  await pagesBox(page).fill("");
  expect(await marked(page)).toEqual([]);
  await expect(runButton(page)).toBeDisabled();
});

test("remove pages - every page marked is stopped with a clear note", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await pagesBox(page).fill("1-3");
  await expect(page.getByTestId("remove-error")).toHaveText("Keep at least one page. A PDF can't be empty.");
  await expect(runButton(page)).toBeDisabled();
  await pageButton(page, 2).click();
  await expect(page.getByTestId("remove-error")).toBeHidden();
  await expect(runButton(page)).toBeEnabled();
});

test("remove pages - the new file has the other pages in order, named like other tools", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105, 106, 107]);
  await pageButton(page, 2).click();
  await pageButton(page, 7).click();
  const { name, bytes } = await removeAndDownload(page);
  expect(name).toBe("report_removed.pdf");
  expect(await pageWidths(bytes)).toEqual([101, 103, 104, 105, 106]);
  await expect(page.getByTestId("shell-result-card")).toContainText("Removed 2 pages from report.pdf");
});

test("remove pages - the result can be edited like Merge PDF", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await pageButton(page, 1).click();
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
  const toolbar = page.getByTestId("page-toolbar");
  await expect(toolbar.getByRole("button", { name: "Rotate all" })).toBeVisible();
  await expect(page.locator(".shell-page")).toHaveCount(3);
});

test("remove pages - the magnifier shows a page larger", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await page.getByRole("button", { name: "See page 2 larger" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("Page 2 of 3");
  await page.keyboard.press("Escape");
  expect(await marked(page)).toEqual([]);
});

test("remove pages - password-protected files are flagged and explained", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(page.getByTestId("shell-file")).toContainText("Has a password");
  await expect(page.getByTestId("shell-file").locator(".shell-file-grip")).toBeHidden();
});

test("remove pages - pages can be marked with the keyboard", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await pageButton(page, 3).focus();
  await page.keyboard.press("Space");
  await expect(pagesBox(page)).toHaveValue("3");
  await page.keyboard.press("Enter");
  await expect(pagesBox(page)).toHaveValue("");
});

for (const width of [320, 375, 768, 1366]) {
  test(`remove pages - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [101, 102, 103, 104, 105]);
    // Choosing a file scrolls to the options; tapping a page afterwards may scroll on to that page.
    await expect(page.getByTestId("remove-options").getByRole("heading", { name: "Remove pages" })).toBeInViewport();
    await pageButton(page, 2).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`remove pages - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("report.pdf", [101, 102, 103])]);
    await expect(page.getByTestId("page-grid").locator("img").first()).toBeVisible();
    await pageButton(page, 1).click();
    await pagesBox(page).fill("1-3");
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await pagesBox(page).fill("2");
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${colorScheme}.png`, fullPage: true });
  });
}
