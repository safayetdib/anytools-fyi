import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { makeEncryptedPdf, makeHeavyPdf, makePdf, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/split-pdf";
const PAGE = "/split-pdf/";

// Page widths double as labels, so each page can be told apart in the results.
const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select a PDF file");
const splitButton = (page: Page) => page.getByRole("button", { name: "Split PDF", exact: true });
const tab = (page: Page, name: "Range" | "Pages" | "Size") => page.getByRole("radio", { name, exact: true });
const choice = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const info = (page: Page) => page.getByTestId("split-info");
const from = (page: Page, range: number) => page.getByLabel(`Range ${range}, from page`);
const to = (page: Page, range: number) => page.getByLabel(`Range ${range}, to`);

async function choose(page: Page, widths: number[], name = "report.pdf") {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf(name, widths)]);
  await expect(page.getByTestId("page-grid-range")).toHaveCount(1);
}

async function splitAndDownload(page: Page) {
  await splitButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("split pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Split PDF" })).toBeVisible();
  await expect(picker(page)).toBeAttached();
  for (const heading of ["How to split a PDF", "How splitting works", "Tips for a clean split", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
});

test("split pdf - starts like other tools: Range, Custom, one range over the whole file, no note", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await expect(tab(page, "Range")).toBeChecked();
  await expect(choice(page, "Custom")).toBeChecked();
  await expect(from(page, 1)).toHaveValue("1");
  await expect(to(page, 1)).toHaveValue("4");
  await expect(page.getByTestId("page-grid-range")).toContainText("Range 1");
  await expect(info(page)).toBeHidden();
  // The first range can't be removed or moved on its own.
  await expect(page.getByRole("button", { name: "Remove range 1" })).toHaveCount(0);
});

test("split pdf - custom ranges make one PDF each, named by their pages, in a ZIP", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105]);
  await to(page, 1).fill("2");
  await to(page, 1).blur();
  await page.getByRole("button", { name: "Add range" }).click();
  await expect(from(page, 2)).toHaveValue("3");
  await expect(to(page, 2)).toHaveValue("5");
  await expect(page.getByTestId("page-grid-range")).toHaveCount(2);
  const { name, bytes } = await splitAndDownload(page);
  expect(name).toBe("report-split.zip");
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files)).toEqual(["report-1-2.pdf", "report-3-5.pdf"]);
  expect(await pageWidths(files["report-3-5.pdf"])).toEqual([103, 104, 105]);
  await expect(page.getByRole("heading", { name: "Your 2 files are ready" })).toBeVisible();
  await expect(page.getByTestId("shell-part").first()).toContainText("Pages 1–2");
});

test("split pdf - added ranges can be removed; merging joins ranges in order, overlaps kept", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await page.getByRole("button", { name: "Add range" }).click();
  await page.getByRole("button", { name: "Add range" }).click();
  await expect(page.getByTestId("page-grid-range")).toHaveCount(3);
  await page.getByRole("button", { name: "Remove range 2" }).click();
  await expect(page.getByTestId("page-grid-range")).toHaveCount(2);
  await from(page, 1).fill("3");
  await to(page, 1).fill("4");
  await from(page, 2).fill("1");
  await to(page, 2).fill("3");
  await to(page, 2).blur();
  await page.getByLabel("Merge all ranges in one PDF file").check();
  await expect(info(page)).toBeHidden();
  const { name, bytes } = await splitAndDownload(page);
  expect(name).toBe("report-extracted.pdf");
  expect(await pageWidths(bytes)).toEqual([103, 104, 101, 102, 103]);
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
});

test("split pdf - range numbers are corrected quietly when leaving a field", async ({ page }) => {
  await choose(page, Array.from({ length: 12 }, (_, i) => 101 + i));
  await page.getByRole("button", { name: "Add range" }).click();
  // Past the last page becomes the last page.
  await to(page, 2).fill("20");
  await to(page, 2).blur();
  await expect(to(page, 2)).toHaveValue("12");
  // An end before the start is raised to the start.
  await from(page, 2).fill("5");
  await to(page, 2).fill("3");
  await to(page, 2).blur();
  await expect(to(page, 2)).toHaveValue("5");
  // Raising the start above the end raises the end too.
  await from(page, 2).fill("9");
  await from(page, 2).blur();
  await expect(to(page, 2)).toHaveValue("9");
  // Zero becomes the first page.
  await from(page, 1).fill("0");
  await from(page, 1).blur();
  await expect(from(page, 1)).toHaveValue("1");
  await expect(page.getByTestId("shell-error")).toBeHidden();
});

test("split pdf - ranges can be put in another order with the grip", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await to(page, 1).fill("1");
  await to(page, 1).blur();
  await page.getByRole("button", { name: "Add range" }).click();
  await expect(from(page, 2)).toHaveValue("2");
  await page.getByRole("button", { name: /^Move range 2/ }).press("ArrowUp");
  await expect(from(page, 1)).toHaveValue("2");
  await expect(from(page, 2)).toHaveValue("1");
  await expect(page.getByRole("button", { name: /^Move range 1/ })).toBeFocused();
  await expect(page.getByTestId("page-grid-range").first()).toContainText("2");
  // Dragging works too.
  const grip = page.getByRole("button", { name: /^Move range 2/ });
  const target = await page.getByTestId("split-ranges").locator("li").first().boundingBox();
  await grip.hover();
  await page.mouse.down();
  await page.mouse.move(target!.x + 20, target!.y + 4, { steps: 8 });
  await page.mouse.up();
  await expect(from(page, 1)).toHaveValue("1");
});

test("split pdf - the range being edited is highlighted in the list and the preview", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await to(page, 1).fill("2");
  await to(page, 1).blur();
  await page.getByRole("button", { name: "Add range" }).click();
  await expect(page.getByTestId("page-grid-range").nth(1)).toHaveAttribute("data-active", "");
  await from(page, 1).focus();
  await expect(page.getByTestId("page-grid-range").first()).toHaveAttribute("data-active", "");
  await expect(page.getByTestId("page-grid-range").nth(1)).not.toHaveAttribute("data-active", "");
});

test("split pdf - fixed ranges split every N pages, with the count in bold", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105]);
  await choice(page, "Fixed").check();
  await expect(page.getByLabel("Split into page ranges of")).toHaveValue("1");
  await expect(info(page)).toHaveText("This PDF will be split into files of 1 pages. 5 PDFs will be created.");
  await page.getByLabel("Split into page ranges of").fill("2");
  await expect(info(page)).toHaveText("This PDF will be split into files of 2 pages. 3 PDFs will be created.");
  await expect(info(page).locator("strong")).toHaveText("3 PDFs");
  await expect(page.getByTestId("page-grid-range")).toHaveCount(3);
  const { bytes } = await splitAndDownload(page);
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files)).toEqual(["report-1.pdf", "report-2.pdf", "report-3.pdf"]);
  expect(await pageWidths(files["report-3.pdf"])).toEqual([105]);
});

test("split pdf - fixed size of 0 becomes 1", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await choice(page, "Fixed").check();
  await page.getByLabel("Split into page ranges of").fill("0");
  await page.getByLabel("Split into page ranges of").blur();
  await expect(page.getByLabel("Split into page ranges of")).toHaveValue("1");
});

test("split pdf - extract all pages makes one PDF per page, named by page", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await tab(page, "Pages").check();
  await expect(choice(page, "Extract all pages")).toBeChecked();
  await expect(info(page)).toHaveText("Selected pages will be converted into separate PDF files. 3 PDFs will be created.");
  await expect(page.getByTestId("page-grid-item")).toHaveCount(3);
  await expect(page.getByLabel("Merge extracted pages into one PDF file")).toBeHidden();
  const { bytes } = await splitAndDownload(page);
  expect(Object.keys(unzipSync(new Uint8Array(bytes)))).toEqual(["report-1.pdf", "report-2.pdf", "report-3.pdf"]);
});

test("split pdf - tapping a page in Extract all switches to Select pages without it", async ({ page }) => {
  await choose(page, Array.from({ length: 12 }, (_, i) => 101 + i));
  await tab(page, "Pages").check();
  await page.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(choice(page, "Select pages")).toBeChecked();
  await expect(page.getByLabel("Pages to extract")).toHaveValue("1-2,4-12");
  await expect(page.getByRole("button", { name: "Page 3", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(info(page)).toHaveText("Selected pages will be converted into separate PDF files. 11 PDFs will be created.");
});

test("split pdf - Select pages starts empty, with Split PDF unavailable until a page is chosen", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await tab(page, "Pages").check();
  await choice(page, "Select pages").check();
  await expect(page.getByLabel("Pages to extract")).toHaveValue("");
  await expect(page.getByLabel("Pages to extract")).toHaveAttribute("placeholder", "example: 1,5-8");
  await expect(info(page)).toHaveText("Selected pages will be converted into separate PDF files. 0 PDFs will be created.");
  await expect(splitButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(splitButton(page)).toBeEnabled();
});

test("split pdf - select pages by tapping or typing; merging hides the count", async ({ page }) => {
  await choose(page, [101, 102, 103, 104, 105]);
  await tab(page, "Pages").check();
  await choice(page, "Select pages").check();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.getByRole("button", { name: "Page 4", exact: true }).click();
  await page.getByRole("button", { name: "Page 5", exact: true }).click();
  await expect(page.getByLabel("Pages to extract")).toHaveValue("2,4-5");
  await page.getByLabel("Pages to extract").fill("1,3");
  await expect(page.getByRole("button", { name: "Page 3", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Page 4", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(info(page)).toHaveText("Selected pages will be converted into separate PDF files. 2 PDFs will be created.");
  const separate = await splitAndDownload(page);
  expect(Object.keys(unzipSync(new Uint8Array(separate.bytes)))).toEqual(["report-1.pdf", "report-3.pdf"]);
  await page.getByTestId("shell-result-card").getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  await choose(page, [101, 102, 103, 104, 105]);
  await tab(page, "Pages").check();
  await choice(page, "Select pages").check();
  await page.getByLabel("Pages to extract").fill("1,3");
  await page.getByLabel("Merge extracted pages into one PDF file").check();
  await expect(info(page)).toBeHidden();
  const merged = await splitAndDownload(page);
  expect(merged.name).toBe("report-extracted.pdf");
  expect(await pageWidths(merged.bytes)).toEqual([101, 103]);
});

test("split pdf - typed pages keep only digits, commas and dashes, and skip what doesn't fit", async ({ page }) => {
  await choose(page, Array.from({ length: 12 }, (_, i) => 101 + i));
  await tab(page, "Pages").check();
  await choice(page, "Select pages").check();
  await page.getByLabel("Pages to extract").pressSequentially("2, 5-7, 20, x");
  await expect(page.getByLabel("Pages to extract")).toHaveValue("2,5-7,20,");
  await expect(info(page)).toContainText("4 PDFs will be created.");
  await expect(page.getByTestId("shell-error")).toBeHidden();
});

test("split pdf - the magnifier shows a page larger", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await tab(page, "Pages").check();
  await page.getByRole("button", { name: "See page 2 larger" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("Page 2 of 3");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "See page 2 larger" })).toBeFocused();
});

test("split pdf - size keeps every file under the limit", async ({ page }) => {
  // Ten pages of about 4 KB each, so a 12 KB limit needs several files.
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeHeavyPdf(10, 4)) }]);
  await expect(page.getByTestId("page-grid-range")).toHaveCount(1);
  await tab(page, "Size").check();
  await expect(page.getByText("Total pages:")).toBeVisible();
  await expect(page.getByTestId("page-grid")).toContainText("report.pdf");
  await page.getByLabel("Maximum size per file").fill("1");
  await expect(page.getByTestId("split-size-error")).toHaveText("Enter a size of at least 10 KB.");
  await page.getByLabel("Maximum size per file").fill("12");
  await expect(info(page)).toHaveText("This PDF will be split into files no larger than 12 KB each.");
  await splitButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your \d+ files are ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const files = Object.values(unzipSync(new Uint8Array(await readFile(await (await pending).path()))));
  expect(files.length).toBeGreaterThan(1);
  for (const file of files) expect(file.length).toBeLessThanOrEqual(12 * 1024);
  expect((await Promise.all(files.map((file) => pageWidths(file)))).flat()).toEqual(Array.from({ length: 10 }, (_, i) => 200 + i));
});

test("split pdf - each part can be opened page by page", async ({ page }) => {
  await choose(page, [101, 102, 103, 104]);
  await choice(page, "Fixed").check();
  await page.getByLabel("Split into page ranges of").fill("2");
  await splitButton(page).click();
  await expect(page.getByTestId("shell-part")).toHaveCount(2);
  // Each card shows its part's first page.
  await expect(page.getByTestId("shell-part").locator("img")).toHaveCount(2);
  await page.getByRole("button", { name: "Preview report-2.pdf" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("report-2.pdf");
  await expect(viewer).toContainText("Page 1 of 2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Preview report-2.pdf" })).toBeFocused();
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download report-1.pdf" }).click();
  expect(await pageWidths(await readFile(await (await pending).path()))).toEqual([101, 102]);
});

test("split pdf - password-protected files are flagged and explained", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(page.getByTestId("shell-file")).toContainText("Has a password");
  await splitButton(page).click();
  await expect(page.getByTestId("shell-error")).toContainText("locked.pdf has a password");
});

test("split pdf - tabs and modes work with the keyboard", async ({ page }) => {
  await choose(page, [101, 102]);
  await tab(page, "Range").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Pages")).toBeChecked();
  await expect(choice(page, "Extract all pages")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tab(page, "Size")).toBeChecked();
  await expect(page.getByLabel("Maximum size per file")).toBeVisible();
});

test("split pdf - a long file draws only the pages in view", async ({ page }) => {
  await choose(page, Array.from({ length: 120 }, (_, index) => 100 + index));
  await tab(page, "Pages").check();
  await expect(info(page)).toContainText("120 PDFs will be created.");
  await expect(page.getByTestId("page-grid-item").first().locator("img")).toBeVisible();
  expect(await page.getByTestId("page-grid").locator("img").count()).toBeLessThan(60);
});

for (const width of [320, 375, 768, 1366]) {
  test(`split pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [101, 102, 103, 104, 105]);
    await to(page, 1).fill("2");
    await page.getByRole("button", { name: "Add range" }).click();
    await expect(page.getByTestId("page-grid-range")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/range-${width}.png`, fullPage: true });
    await tab(page, "Pages").check();
    await choice(page, "Select pages").check();
    await page.getByRole("button", { name: "Page 2", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/pages-${width}.png`, fullPage: true });
    await choice(page, "Extract all pages").check();
    await splitButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`split pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("report.pdf", [101, 102, 103, 104])]);
    await page.getByRole("button", { name: "Add range" }).click();
    await expect(page.getByTestId("page-grid").locator("img").first()).toBeVisible();
    const { violations: ranges } = await new AxeBuilder({ page }).analyze();
    expect(ranges.map((v) => v.id)).toEqual([]);
    await tab(page, "Pages").check();
    await choice(page, "Select pages").check();
    await page.getByRole("button", { name: "Page 1", exact: true }).click();
    const { violations: pages } = await new AxeBuilder({ page }).analyze();
    expect(pages.map((v) => v.id)).toEqual([]);
    await tab(page, "Size").check();
    const { violations: size } = await new AxeBuilder({ page }).analyze();
    expect(size.map((v) => v.id)).toEqual([]);
    await tab(page, "Pages").check();
    await choice(page, "Extract all pages").check();
    await splitButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(4);
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${colorScheme}.png`, fullPage: true });
  });
}

for (const width of [375, 1366]) {
  test(`split pdf - choosing a file scrolls to the split options at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await choose(page, [101, 102, 103]);
    await expect(page.getByTestId("split-options").getByRole("heading", { name: "Split", exact: true })).toBeInViewport();
  });
}

test("split pdf - the chosen tab and option are filled and ticked", async ({ page }) => {
  await choose(page, [101, 102]);
  const custom = page.getByTestId("split-options").locator("label").filter({ has: choice(page, "Custom") });
  const fixed = page.getByTestId("split-options").locator("label").filter({ has: choice(page, "Fixed") });
  await expect(custom.locator(".split-tick")).toBeVisible();
  await expect(fixed.locator(".split-tick")).toBeHidden();
  const fill = (label: typeof custom) => label.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await fill(custom)).not.toBe(await fill(fixed));
  const rangeTab = page.getByTestId("split-options").locator("label").filter({ has: tab(page, "Range") });
  await expect(rangeTab.locator(".split-tab-badge")).toBeVisible();
  await tab(page, "Pages").check();
  await expect(rangeTab.locator(".split-tab-badge")).toBeHidden();
});

test("split pdf - start over asks right under the result card, before the files", async ({ page }) => {
  await choose(page, [101, 102, 103]);
  await tab(page, "Pages").check();
  await splitButton(page).click();
  await expect(page.getByTestId("shell-part")).toHaveCount(3);
  await page.getByTestId("shell-result-card").getByRole("button", { name: "Start over" }).click();
  const question = page.getByText("Start over? The files you made and any page changes will be cleared");
  await expect(question).toBeVisible();
  const card = await page.getByTestId("shell-result-card").boundingBox();
  const ask = await question.boundingBox();
  const files = await page.getByTestId("shell-parts").boundingBox();
  expect(ask!.y).toBeGreaterThan(card!.y + card!.height);
  expect(ask!.y).toBeLessThan(files!.y);
  await page.getByRole("button", { name: "Keep my file" }).click();
  await expect(question).toBeHidden();
});

for (const width of [320, 375, 768, 1366]) {
  test(`split pdf - option labels stay on one line at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [101, 102]);
    for (const name of ["Range", "Pages", "Size"] as const) {
      await tab(page, name).check();
      // A wrapped label has more than one line box.
      const lines = await page
        .getByTestId("split-options")
        .locator(".split-switch-options label:visible span, .split-tab span:not(.split-tab-badge)")
        .evaluateAll((spans) => spans.map((span) => [span.textContent, span.getClientRects().length]));
      for (const [text, count] of lines) expect(count, `${text} at ${width}px`).toBe(1);
    }
  });
}

for (const width of [375, 1366]) {
  test(`split pdf - the one file has no drag grip or number, and Remove is right there at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [101, 102]);
    const row = page.getByTestId("shell-file");
    await expect(row.locator(".shell-file-grip")).toBeHidden();
    await expect(row.locator(".shell-file-order")).toBeHidden();
    await expect(row.getByRole("button", { name: /^More/ })).toHaveCount(0);
    await row.getByRole("button", { name: "Remove report.pdf" }).click();
    await expect(picker(page)).toBeAttached();
    await expect(row).toHaveCount(0);
  });
}
