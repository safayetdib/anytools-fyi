import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeEncryptedPdf, makePdf, pageRotations, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/organize-pdf";
const PAGE = "/organize-pdf/";

// Page widths double as labels, so each page can be told apart in the result.
const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("organize-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Organize", exact: true });
const cards = (page: Page) => page.getByTestId("organize-page");
const labels = (page: Page) => cards(page).evaluateAll((items) => items.map((item) => (item as HTMLElement).dataset.label));

async function choose(page: Page, files: { name: string; widths: number[] }[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(await Promise.all(files.map(({ name, widths }) => pdf(name, widths))));
  await expect(cards(page)).toHaveCount(files.reduce((sum, file) => sum + file.widths.length, 0));
}

async function organizeAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("organize pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Organize PDF" })).toBeVisible();
  for (const heading of ["How to organize a PDF", "How organizing works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/organize-pdf/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/organize-pdf.png");
});

test("organize pdf - every page of every file shows, labelled by file letter", async ({ page }) => {
  await choose(page, [
    { name: "report.pdf", widths: [101, 102] },
    { name: "second.pdf", widths: [201] },
  ]);
  expect(await labels(page)).toEqual(["A1", "A2", "B1"]);
  await expect(panel(page).getByRole("heading", { name: "Organize PDF" })).toBeVisible();
  await expect(panel(page)).toContainText("A: report.pdf");
  await expect(panel(page)).toContainText("B: second.pdf");
  await expect(panel(page).getByRole("button", { name: "Reset all" })).toBeHidden();
  await expect(runButton(page)).toBeEnabled();
});

test("organize pdf - one file's pages are labelled by number only", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102, 103] }]);
  expect(await labels(page)).toEqual(["1", "2", "3"]);
});

test("organize pdf - rotate, delete and add a blank page, then Reset all puts it back", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102, 103] }]);
  await page.getByRole("button", { name: "Rotate page 2" }).click();
  await expect(cards(page).nth(1)).toHaveAttribute("data-turn", "90");
  await page.getByRole("button", { name: "Delete page 3" }).click();
  await page.getByRole("button", { name: "Add a blank page before page 1" }).click();
  expect(await labels(page)).toEqual(["blank", "1", "2"]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/changed.png`, fullPage: true });
  await panel(page).getByRole("button", { name: "Reset all" }).click();
  expect(await labels(page)).toEqual(["1", "2", "3"]);
  await expect(cards(page).nth(1)).toHaveAttribute("data-turn", "0");
});

test("organize pdf - the new file follows the grid: order, turns, blanks and deletions", async ({ page }) => {
  await choose(page, [
    { name: "a.pdf", widths: [101, 102, 103] },
    { name: "b.pdf", widths: [201] },
  ]);
  await page.getByRole("button", { name: "Delete page A2" }).click();
  await page.getByRole("button", { name: "Rotate page B1" }).click();
  await page.getByRole("button", { name: "Add a blank page before page A3" }).click();
  // Move B1 to the front with the keyboard.
  await cards(page).filter({ has: page.getByRole("button", { name: "Rotate page B1" }) }).focus();
  for (let step = 0; step < 3; step++) await page.keyboard.press("Alt+ArrowLeft");
  expect(await labels(page)).toEqual(["B1", "A1", "blank", "A3"]);
  const { name, bytes } = await organizeAndDownload(page);
  expect(name).toBe("organized.pdf");
  // The blank page takes its size from A3, the page after it.
  expect(await pageWidths(bytes)).toEqual([201, 101, 103, 103]);
  expect(await pageRotations(bytes)).toEqual([90, 0, 0, 0]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("organize pdf - pages can be dragged to a new place", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102, 103, 104] }]);
  // Wait for the page to finish scrolling to the options, so the cards stay put while dragging.
  await expect(panel(page).getByRole("heading", { name: "Organize PDF" })).toBeInViewport();
  await page.waitForFunction(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))));
  await cards(page).nth(2).scrollIntoViewIfNeeded();
  const first = await cards(page).nth(0).boundingBox();
  const third = await cards(page).nth(2).boundingBox();
  if (!first || !third) throw new Error("No cards");
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width * 0.8, third.y + third.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(await labels(page)).toEqual(["2", "3", "1", "4"]);
});

test("organize pdf - every page deleted is stopped with a clear note", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102] }]);
  await page.getByRole("button", { name: "Delete page 1" }).click();
  await page.getByRole("button", { name: "Delete page 2" }).click();
  await expect(page.getByTestId("organize-error")).toHaveText("Keep at least one page. A PDF can't be empty.");
  await expect(runButton(page)).toBeDisabled();
  await panel(page).getByRole("button", { name: "Reset all" }).click();
  await expect(runButton(page)).toBeEnabled();
});

test("organize pdf - adding a file adds its pages at the end", async ({ page }) => {
  await choose(page, [{ name: "a.pdf", widths: [101] }]);
  await page.getByRole("button", { name: "Delete page 1" }).click();
  await page.getByLabel("Add more files").setInputFiles([await pdf("b.pdf", [201, 202])]);
  await expect(cards(page)).toHaveCount(2);
  expect(await labels(page)).toEqual(["B1", "B2"]);
});

test("organize pdf - password-protected files are flagged", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(page.getByTestId("shell-file")).toContainText("Has a password");
});

for (const width of [320, 375, 768, 1366]) {
  test(`organize pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [
      { name: "a-long-file-name-that-should-not-overflow.pdf", widths: [101, 102, 103] },
      { name: "b.pdf", widths: [450] },
    ]);
    await expect(panel(page).getByRole("heading", { name: "Organize PDF" })).toBeInViewport();
    await page.getByRole("button", { name: "Rotate page A2" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // The + before the first page in a row stays fully on screen.
    const add = await page.getByRole("button", { name: "Add a blank page before page A1" }).boundingBox();
    expect(add?.x).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`organize pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", [101, 102]), await pdf("b.pdf", [450])]);
    await expect(cards(page).locator("img")).toHaveCount(3);
    await page.getByRole("button", { name: "Rotate page A1" }).click();
    await page.getByRole("button", { name: "Add a blank page before page B1" }).click();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
