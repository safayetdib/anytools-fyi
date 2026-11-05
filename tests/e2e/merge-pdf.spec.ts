import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeEncryptedPdf, makePdf, pageCropBoxes, pageRotations, pageSizes, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/merge-pdf";
const PAGE = "/merge-pdf/";

const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const mergeButton = (page: Page) => page.getByRole("button", { name: "Merge PDF", exact: true });

async function mergeAndRead(page: Page) {
  await mergeButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /^Download merged\.pdf/ }).click();
  const download = await pending;
  return pageWidths(await readFile(await download.path()));
}

test("merge pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Merge PDF" })).toBeVisible();
  await expect(picker(page)).toBeAttached();
  await expect(page.getByText("This tool is being built")).toHaveCount(0);
  for (const heading of ["How to merge PDF files", "Limits", "How merging works", "Tips for a clean result", "Why your files stay private", "Questions"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.locator("summary", { hasText: "Does this upload my files?" })).toBeVisible();
  const types = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(types.map((text) => JSON.parse(text)["@type"])).toContain("FAQPage");
});

test("merge pdf - merges files in the chosen order", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("first.pdf", [100]), await pdf("second.pdf", [200, 210])]);
  expect(await mergeAndRead(page)).toEqual([100, 200, 210]);
  await expect(page.getByTestId("shell-live")).toContainText("2 PDFs merged");
});

test("merge pdf - reordering changes the merged order", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("first.pdf", [100]), await pdf("second.pdf", [200])]);
  await page.getByRole("button", { name: "Move second.pdf up" }).click();
  expect(await mergeAndRead(page)).toEqual([200, 100]);
});

test("merge pdf - needs at least two files", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("only.pdf", [100])]);
  await mergeButton(page).click();
  await expect(page.getByTestId("shell-error")).toContainText("at least 2");
});

test("merge pdf - explains password-protected and broken files and keeps the list", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([
    await pdf("ok.pdf", [100]),
    { name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) },
  ]);
  await mergeButton(page).click();
  await expect(page.getByTestId("shell-error")).toContainText("locked.pdf");
  await expect(page.getByTestId("shell-error")).toContainText("password");
  await expect(page.getByTestId("shell-file")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove locked.pdf" }).click();
  await picker(page).setInputFiles([]).catch(() => {});
  await page.getByLabel("Add more files").setInputFiles([
    { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf") },
  ]);
  await mergeButton(page).click();
  await expect(page.getByTestId("shell-error")).toContainText("broken.pdf");
});

test("merge pdf - rejects files that aren't PDFs", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") }]);
  await expect(page.getByTestId("shell-error")).toContainText("Choose PDF files");
});

test("merge pdf - loads the PDF library only after files are chosen, and never uploads", async ({ page }) => {
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto(PAGE);
  await page.waitForLoadState("networkidle");
  expect(requests.some((r) => r.url.includes("worker"))).toBe(false);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  await mergeAndRead(page);
  expect(requests.some((r) => r.url.includes("worker"))).toBe(true);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:"))).toEqual([]);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
});

test("merge pdf - works offline once files are chosen", async ({ page, context }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  expect(await mergeAndRead(page)).toEqual([100, 200]);
  await context.setOffline(false);
});

test("merge pdf - cancelling stops the job and the next merge still works", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto(PAGE);
  const big = await pdf("big.pdf", Array.from({ length: 400 }, () => 100));
  await picker(page).setInputFiles([big, await pdf("small.pdf", [200])]);
  await mergeButton(page).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("shell-live")).toContainText("Cancelled");
  const widths = await mergeAndRead(page);
  expect(widths).toHaveLength(401);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`merge pdf - no axe violations with a result in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: before } = await new AxeBuilder({ page }).analyze();
    expect(before.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/page-${colorScheme}.png`, fullPage: true });
    await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
    await mergeAndRead(page);
    const { violations: after } = await new AxeBuilder({ page }).analyze();
    expect(after.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${colorScheme}.png`, fullPage: true });
  });
}

for (const width of [320, 375, 768, 1366]) {
  test(`merge pdf - fits ${width}px with files listed`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await picker(page).setInputFiles([await pdf("first-document-with-a-long-name.pdf", [100]), await pdf("b.pdf", [200])]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/working-${width}.png`, fullPage: true });
  });
}

// --- Previews and guidance ---

const imagesLoaded = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((images) => images.map((img) => (img as HTMLImageElement).naturalWidth > 0));

test("merge pdf - guides the visitor before and after choosing files", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByText("Choose 2 or more PDF files, up to 100 MB each.")).toBeVisible();
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200, 210])]);
  await expect(page.getByText("Drag files, or use the arrows, to change the order.")).toBeVisible();
  await expect(page.getByTestId("shell-total")).toHaveText(/^2 files · 3 pages · [\d.]+ (B|KB)$/);
});

test("merge pdf - shows a first-page preview and page count for each file", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200, 210])]);
  await expect(page.getByTestId("shell-file").nth(0)).toContainText("1 page");
  await expect(page.getByTestId("shell-file").nth(1)).toContainText("2 pages");
  await expect.poll(() => imagesLoaded(page, '[data-testid="shell-file"] img')).toEqual([true, true]);
});

test("merge pdf - flags a password-protected file before merging", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([
    await pdf("ok.pdf", [100]),
    { name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) },
  ]);
  await expect(page.getByTestId("shell-file").nth(1)).toContainText("Has a password");
});

test("merge pdf - previews the merged pages, with a larger view, before download", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200, 210])]);
  await mergeButton(page).click();
  await expect(page.locator('[data-el="summary"]')).toContainText("Done. 2 PDFs merged");
  await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
  const thumbs = page.getByRole("button", { name: /^Open page \d larger$/ });
  await expect(thumbs).toHaveCount(3);
  await expect.poll(() => imagesLoaded(page, ".shell-pages img")).toEqual([true, true, true]);
  await thumbs.nth(1).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toContainText("Page 2 of 3");
  await viewer.getByRole("button", { name: "Next page" }).click();
  await expect(viewer).toContainText("Page 3 of 3");
  await expect(viewer.getByRole("button", { name: "Previous page" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer).toContainText("Page 2 of 3");
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(thumbs.nth(1)).toBeFocused();
});

test("merge pdf - long results preview in batches", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", Array.from({ length: 20 }, () => 100)), await pdf("b.pdf", Array.from({ length: 10 }, () => 200))]);
  await mergeButton(page).click();
  const thumbs = page.getByRole("button", { name: /^Open page \d+ larger$/ });
  await expect(thumbs).toHaveCount(12);
  await expect(page.getByText("Showing 12 of 30 pages")).toBeVisible();
  await page.getByRole("button", { name: /^Show \d+ more pages?$/ }).click();
  await expect(thumbs).toHaveCount(24);
  await page.getByRole("button", { name: /^Show \d+ more pages?$/ }).click();
  await expect(thumbs).toHaveCount(30);
  await expect(page.getByRole("button", { name: /^Show \d+ more pages?$/ })).toBeHidden();
});

test("merge pdf - action buttons don't touch", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  const add = await page.locator(".shell-add").boundingBox();
  const run = await mergeButton(page).boundingBox();
  expect(add && run).toBeTruthy();
  const gapX = (run?.x ?? 0) - ((add?.x ?? 0) + (add?.width ?? 0));
  const gapY = (run?.y ?? 0) - ((add?.y ?? 0) + (add?.height ?? 0));
  expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(8);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`merge pdf - previews and the page viewer have no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
    await expect.poll(() => imagesLoaded(page, '[data-testid="shell-file"] img')).toEqual([true, true]);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/previews-${colorScheme}.png`, fullPage: true });
    await mergeButton(page).click();
    await expect.poll(() => imagesLoaded(page, ".shell-pages img")).toEqual([true, true]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-preview-${colorScheme}.png`, fullPage: true });
    await page.getByRole("button", { name: "Open page 1 larger" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer-${colorScheme}.png` });
  });
}

// --- Visual guidance ---

test("merge pdf - guidance shows limits as cards and steps in order", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("limit-card")).toHaveCount(5);
  await expect(page.getByTestId("limit-card").first()).toContainText("PDF");
  await expect(page.getByTestId("limit-card").nth(1)).toContainText("100 MB");
  const steps = page.getByTestId("step");
  await expect(steps).toHaveCount(5);
  await expect(steps.first()).toContainText("Select your PDFs");
  await expect(page.getByTestId("tip-card")).toHaveCount(4);
});

test("merge pdf - the diagram shows how order changes the merged file", async ({ page }) => {
  await page.goto(PAGE);
  const diagram = page.getByRole("figure", { name: /merged/i }).first();
  const result = diagram.getByTestId("result-page");
  await expect(result).toHaveText(["1", "2", "1", "2", "3"]);
  await expect(result.first()).toHaveAttribute("data-file", "a");
  await diagram.getByRole("button", { name: "Swap the file order" }).click();
  await expect(result.first()).toHaveAttribute("data-file", "b");
  await expect(diagram.locator("figcaption")).toContainText("transcript.pdf comes first");
  await diagram.getByRole("button", { name: "Swap the file order" }).click();
  await expect(result.first()).toHaveAttribute("data-file", "a");
});

test("merge pdf - the privacy diagram compares uploading with staying on the device", async ({ page }) => {
  await page.goto(PAGE);
  const privacy = page.getByRole("figure", { name: /upload/i });
  await expect(privacy).toContainText("Most online tools");
  await expect(privacy).toContainText("AnyTools");
  await expect(privacy).toContainText("Nothing is sent");
});

test("merge pdf - questions open and close, and answers stay in the page", async ({ page }) => {
  await page.goto(PAGE);
  const question = page.locator("summary", { hasText: "Does it work offline?" });
  const answer = page.getByText("Yes, once your files are chosen.");
  await expect(answer).toBeAttached();
  await expect(answer).toBeHidden();
  await question.click();
  await expect(answer).toBeVisible();
  await question.focus();
  await page.keyboard.press("Enter");
  await expect(answer).toBeHidden();
});

for (const width of [375, 768, 1366]) {
  test(`merge pdf - guidance fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator(".help").screenshot({ path: `${SCREENSHOT_DIR}/guidance-${width}.png` });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`merge pdf - guidance with an open answer has no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    await page.locator("summary").first().click();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.locator(".help").screenshot({ path: `${SCREENSHOT_DIR}/guidance-${colorScheme}.png` });
  });
}

// --- Action layout ---

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox()) as { x: number; y: number; width: number; height: number };

test("merge pdf - the main actions sit together in one bar with the totals", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  const bar = page.getByTestId("shell-action-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId("shell-total")).toBeVisible();
  await expect(bar.getByRole("button", { name: "Merge PDF" })).toBeVisible();
  await expect(bar.getByText("Add more files")).toBeVisible();
  const add = await box(page, ".shell-add");
  const run = await box(page, ".shell-run");
  expect(run.x - (add.x + add.width)).toBeLessThanOrEqual(24);
  expect(run.height).toBeGreaterThanOrEqual(52);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/action-bar-1366.png` });
});

test("merge pdf - download and start over sit together", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  await mergeButton(page).click();
  const bar = page.getByTestId("shell-result-bar");
  await expect(bar.getByRole("link", { name: /^Download merged\.pdf/ })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Start over" })).toBeVisible();
  const download = await box(page, ".shell-downloads a");
  const reset = await box(page, '[data-el="reset"]');
  expect(Math.abs(download.y + download.height / 2 - (reset.y + reset.height / 2))).toBeLessThanOrEqual(4);
});

test("merge pdf - the page count and Show more have room between them", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", Array.from({ length: 20 }, () => 100)), await pdf("b.pdf", [200])]);
  await mergeButton(page).click();
  await expect(page.getByRole("button", { name: /^Show \d+ more pages?$/ })).toBeVisible();
  const count = await box(page, '[data-el="preview-count"]');
  const more = await box(page, '[data-el="more"]');
  const gap = Math.max(more.x - (count.x + count.width), more.y - (count.y + count.height));
  expect(gap).toBeGreaterThanOrEqual(16);
});

for (const width of [375, 1366]) {
  test(`merge pdf - action bars fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", Array.from({ length: 14 }, () => 200))]);
    await page.getByTestId("shell-action-bar").screenshot({ path: `${SCREENSHOT_DIR}/actions-${width}.png` });
    await mergeButton(page).click();
    await expect(page.getByRole("button", { name: /^Show \d+ more pages?$/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator('[data-screen="result"]').screenshot({ path: `${SCREENSHOT_DIR}/result-bar-${width}.png` });
  });
}

// --- Editing the merged pages ---

async function mergeForEditing(page: Page, first: number[], second: number[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", first), await pdf("b.pdf", second)]);
  await mergeButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
}

async function applyAndLoad(page: Page) {
  await page.getByRole("button", { name: "Apply changes" }).click();
  const link = page.getByRole("link", { name: /^Download merged\.pdf/ });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent("download");
  await link.click();
  return readFile(await (await pending).path());
}

const toolbar = (page: Page) => page.getByTestId("page-toolbar");
const select = (page: Page, n: number) => page.getByRole("checkbox", { name: `Select page ${n}` });
const tiles = (page: Page) => page.getByRole("button", { name: /^Open page \d+ larger$/ });

async function moveSelectedTo(page: Page, position: number) {
  await toolbar(page).getByText("Move to…").click();
  await toolbar(page).getByLabel("Move to position").fill(String(position));
  await toolbar(page).getByRole("button", { name: "Move", exact: true }).click();
}

test("edit pages - the toolbar explains what to do before anything is selected", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  const bar = toolbar(page);
  await expect(bar).toContainText("Select pages to rotate, move or remove them");
  await expect(bar.getByRole("button", { name: "Select all" })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Rotate all" })).toBeVisible();
  await expect(bar.locator("summary", { hasText: /^Page size/ })).toBeVisible();
  await expect(page.locator(".shell-page-item button[data-move], .shell-page-item button[data-remove]")).toHaveCount(0);
});

test("edit pages - selecting pages switches the toolbar to page actions", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 2).check();
  await expect(toolbar(page)).toContainText("1 page selected");
  await select(page, 3).check();
  await expect(toolbar(page)).toContainText("2 pages selected");
  for (const name of ["Rotate", "Remove", "Clear"]) {
    await expect(toolbar(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(toolbar(page).getByText("Move to…")).toBeVisible();
  await toolbar(page).getByRole("button", { name: "Clear", exact: true }).click();
  await expect(toolbar(page)).toContainText("Select pages to rotate");
});

test("edit pages - clicking the page number selects it too", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.locator(".shell-page-check", { hasText: "Page 2" }).click();
  await expect(select(page, 2)).toBeChecked();
});

test("edit pages - shift-click selects a range", async ({ page }) => {
  await mergeForEditing(page, [100, 100], [200, 210]);
  await select(page, 1).click();
  await select(page, 3).click({ modifiers: ["Shift"] });
  await expect(toolbar(page)).toContainText("3 pages selected");
});

test("edit pages - move selected pages to a position, then apply", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 3).check();
  await moveSelectedTo(page, 1);
  await expect(page.getByTestId("shell-live")).toContainText("position 1");
  await expect(page.getByText("You've changed the pages.")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Download merged\.pdf/ })).toBeHidden();
  expect(await pageWidths(await applyAndLoad(page))).toEqual([210, 100, 200]);
});

test("edit pages - remove selected pages, then apply", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 1).check();
  await select(page, 3).check();
  await toolbar(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(tiles(page)).toHaveCount(1);
  expect(await pageWidths(await applyAndLoad(page))).toEqual([200]);
});

test("edit pages - the last page can't be removed", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.getByRole("button", { name: "Open page 1 larger" }).click();
  const viewer = page.getByRole("dialog");
  await viewer.getByRole("button", { name: "Remove this page" }).click();
  await expect(viewer).toContainText("Page 1 of 1");
  await viewer.getByRole("button", { name: "Remove this page" }).click();
  await expect(page.getByTestId("shell-live")).toContainText("needs at least one page");
  await expect(viewer).toContainText("Page 1 of 1");
});

test("edit pages - rotate selected pages and see them turn", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  const thumb = () => page.locator('.shell-page-item[data-page="2"] img');
  await expect.poll(() => thumb().evaluate((img) => (img as HTMLImageElement).naturalHeight > (img as HTMLImageElement).naturalWidth)).toBe(true);
  await select(page, 2).check();
  await toolbar(page).getByRole("button", { name: "Rotate", exact: true }).click();
  await expect.poll(() => thumb().evaluate((img) => (img as HTMLImageElement).naturalWidth > (img as HTMLImageElement).naturalHeight)).toBe(true);
  expect(await pageRotations(await applyAndLoad(page))).toEqual([0, 90, 0]);
});

test("edit pages - rotate all pages at once", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await toolbar(page).getByRole("button", { name: "Rotate all" }).click();
  await expect(page.getByTestId("shell-live")).toContainText("All pages turned");
  expect(await pageRotations(await applyAndLoad(page))).toEqual([90, 90, 90]);
});

test("edit pages - Alt and an arrow key move the focused page", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 3).focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(select(page, 2)).toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(select(page, 1)).toBeFocused();
  expect(await pageWidths(await applyAndLoad(page))).toEqual([210, 100, 200]);
});

test("edit pages - drag a page to a new place", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mergeForEditing(page, [100], [200, 210]);
  await page.locator('.shell-page-item[data-page="3"]').dragTo(page.locator('.shell-page-item[data-page="1"]'));
  await expect(page.getByText("You've changed the pages.")).toBeVisible();
  expect(await pageWidths(await applyAndLoad(page))).toEqual([210, 100, 200]);
});

test("edit pages - the larger view can move, turn and remove a page", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await page.getByRole("button", { name: "Open page 3 larger" }).click();
  const viewer = page.getByRole("dialog");
  await viewer.getByLabel("Move to position").fill("1");
  await viewer.getByRole("button", { name: "Move", exact: true }).click();
  await expect(viewer).toContainText("Page 1 of 3");
  await viewer.getByRole("button", { name: "Rotate left" }).click();
  await viewer.getByRole("button", { name: "Next page" }).click();
  await viewer.getByRole("button", { name: "Remove this page" }).click();
  await expect(viewer).toContainText("of 2");
  await page.keyboard.press("Escape");
  const bytes = await applyAndLoad(page);
  expect(await pageWidths(bytes)).toEqual([210, 200]);
  expect(await pageRotations(bytes)).toEqual([270, 0]);
});

test("edit pages - page size lives in its own menu", async ({ page }) => {
  await mergeForEditing(page, [100], [500, 210]);
  await toolbar(page).locator("summary", { hasText: /^Page size/ }).click();
  await page.getByLabel("Page size").selectOption("a4-auto");
  await expect(toolbar(page).locator("summary", { hasText: /^Page size/ })).toContainText("A4, match each page");
  expect(await pageSizes(await applyAndLoad(page))).toEqual([
    [595, 842],
    [842, 595],
    [595, 842],
  ]);
});

test("edit pages - undo puts order, rotation and size back", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 1).check();
  await toolbar(page).getByRole("button", { name: "Remove", exact: true }).click();
  await toolbar(page).getByRole("button", { name: "Rotate all" }).click();
  await toolbar(page).locator("summary", { hasText: /^Page size/ }).click();
  await page.getByLabel("Page size").selectOption("letter-portrait");
  await page.getByRole("button", { name: "Undo changes" }).click();
  await page.getByRole("button", { name: "Yes, undo changes" }).click();
  await expect(tiles(page)).toHaveCount(3);
  await expect(page.getByLabel("Page size")).toHaveValue("original");
  await expect(page.getByRole("link", { name: /^Download merged\.pdf/ })).toBeVisible();
  await expect(page.getByText("You've changed the pages.")).toBeHidden();
});

test("edit pages - edited results can be edited again", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 1).check();
  await toolbar(page).getByRole("button", { name: "Remove", exact: true }).click();
  await applyAndLoad(page);
  await select(page, 2).check();
  await moveSelectedTo(page, 1);
  expect(await pageWidths(await applyAndLoad(page))).toEqual([210, 200]);
});

test("edit pages - the toolbar stays in view while scrolling pages", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 700 });
  await mergeForEditing(page, Array.from({ length: 12 }, () => 100), [200]);
  await page.locator(".shell-page-item").last().scrollIntoViewIfNeeded();
  await expect(toolbar(page)).toBeInViewport();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`edit pages - cards and toolbar have no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await mergeForEditing(page, [100], [200, 210]);
    await page.locator(".shell-preview").screenshot({ path: `${SCREENSHOT_DIR}/editor-idle-${colorScheme}.png` });
    await select(page, 2).check();
    await toolbar(page).getByText("Move to…").click();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.locator(".shell-preview").screenshot({ path: `${SCREENSHOT_DIR}/editor-selected-${colorScheme}.png` });
  });
}

for (const width of [320, 375, 768]) {
  test(`edit pages - toolbar and cards fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mergeForEditing(page, [100, 100], [200, 210]);
    await select(page, 2).check();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const controls = page.locator('[data-testid="page-toolbar"] button:visible, [data-testid="page-toolbar"] summary:visible, .shell-page-check');
    for (let i = 0; i < (await controls.count()); i++) {
      expect((await controls.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.locator(".shell-preview").screenshot({ path: `${SCREENSHOT_DIR}/editor-${width}.png` });
  });
}

// --- Floating action bar ---

async function manyFiles(page: Page, count: number) {
  const files = [];
  for (let i = 1; i <= count; i++) files.push(await pdf(`document-${i}.pdf`, [100 + i]));
  await picker(page).setInputFiles(files);
  await expect(page.getByTestId("shell-file")).toHaveCount(count);
}

for (const [width, height] of [
  [1366, 800],
  [375, 700],
] as const) {
  test(`floating bar - stays at the bottom of the screen with many files at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(PAGE);
    await manyFiles(page, 15);
    await page.evaluate(() => window.scrollTo(0, 0));
    const bar = page.getByTestId("shell-action-bar");
    await expect(bar).toBeInViewport();
    const box = await bar.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
    expect(box?.height ?? 999).toBeLessThanOrEqual(width < 600 ? 140 : 100);
    await expect(bar.getByRole("button", { name: "Merge PDF" })).toBeInViewport();
    await expect(bar.getByLabel("Add more files")).toBeAttached();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/floating-bar-${width}.png` });
  });
}

test("floating bar - a focused row is never hidden behind the bar", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto(PAGE);
  await manyFiles(page, 15);
  await page.evaluate(() => window.scrollTo(0, 0));
  const remove = page.getByRole("button", { name: "Remove document-9.pdf" });
  await remove.focus();
  const button = await remove.boundingBox();
  const bar = await page.getByTestId("shell-action-bar").boundingBox();
  expect((button?.y ?? 0) + (button?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
});

test("floating bar - phones show Add more files as a labelled icon beside Merge", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(PAGE);
  await manyFiles(page, 3);
  const add = await page.locator(".shell-add").boundingBox();
  const run = await page.locator(".shell-run").boundingBox();
  expect(Math.abs((add?.y ?? 0) - (run?.y ?? 0))).toBeLessThanOrEqual(2);
  expect(add?.height ?? 0).toBeGreaterThanOrEqual(44);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// --- Starting over before merging ---

test("start over - asks first, and Keep files changes nothing", async ({ page }) => {
  await page.goto(PAGE);
  await manyFiles(page, 3);
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByText("Remove all 3 files and start over?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep files" })).toBeFocused();
  await page.getByRole("button", { name: "Keep files" }).click();
  await expect(page.getByText("Remove all 3 files and start over?")).toBeHidden();
  await expect(page.getByTestId("shell-file")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Start over" })).toBeFocused();
});

test("start over - removes every file and returns to the start", async ({ page }) => {
  await page.goto(PAGE);
  await manyFiles(page, 3);
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  await expect(picker(page)).toBeFocused();
  await expect(page.getByTestId("shell-file")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Arrange your files" })).toBeHidden();
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  await expect(page.getByTestId("shell-file")).toHaveCount(2);
  await expect(page.getByText("Remove all")).toBeHidden();
});

for (const width of [320, 1366]) {
  test(`start over - fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(PAGE);
    await manyFiles(page, 2);
    await page.getByRole("button", { name: "Start over" }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const name of ["Start over", "Yes, start over", "Keep files"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.locator('[data-screen="working"]').screenshot({ path: `${SCREENSHOT_DIR}/start-over-${width}.png` });
  });
}

test("start over - the question card animates in to catch the eye", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(PAGE);
  await manyFiles(page, 2);
  await page.getByRole("button", { name: "Start over" }).click();
  const card = page.locator('[data-el="clear-confirm"]');
  const names = await card.evaluate((el) => getComputedStyle(el).animationName);
  expect(names).toContain("shell-confirm-in");
  expect(names).toContain("shell-confirm-pulse");
  const duration = await card.evaluate((el) => {
    const style = getComputedStyle(el);
    const seconds = (list: string) => list.split(",").map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 0.001 : 1));
    const [durations, delays, counts] = [seconds(style.animationDuration), seconds(style.animationDelay), style.animationIterationCount.split(",").map(Number)];
    return Math.max(...durations.map((d, i) => delays[i] + d * counts[i]));
  });
  expect(duration).toBeLessThanOrEqual(5);
  await expect(card.locator("svg")).toBeVisible();
});

test("start over - the question card stays still for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await manyFiles(page, 2);
  await page.getByRole("button", { name: "Start over" }).click();
  expect(await page.locator('[data-el="clear-confirm"]').evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

// --- Confirmations are consistent everywhere ---

test("confirm - Start over after merging asks first, and keeping changes nothing", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.getByRole("button", { name: "Start over" }).click();
  const card = page.getByRole("group", { name: /Start over\?/ });
  await expect(card).toContainText("download it first");
  await expect(page.getByRole("button", { name: "Keep my file" })).toBeFocused();
  await page.getByRole("button", { name: "Keep my file" }).click();
  await expect(card).toBeHidden();
  await expect(page.getByRole("link", { name: /^Download merged\.pdf/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start over" })).toBeFocused();
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  await expect(picker(page)).toBeFocused();
});

test("confirm - Undo changes asks first, and keeping keeps the edits", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  await select(page, 1).check();
  await toolbar(page).getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Undo changes" }).click();
  await expect(page.getByRole("group", { name: "Undo all your page changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep changes" }).click();
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByText("You've changed the pages.")).toBeVisible();
});

test("confirm - every question card looks and moves the same", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mergeForEditing(page, [100], [200]);
  await page.getByRole("button", { name: "Start over" }).click();
  const card = page.locator('[data-el="result-confirm"]');
  await expect(card).toHaveClass(/shell-confirm/);
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toContain("shell-confirm-in");
  await expect(card.locator("svg")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
});

// --- Larger view ---

for (const [width, height] of [
  [1366, 700],
  [375, 667],
] as const) {
  test(`viewer - a tall page fits and every control stays on screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(PAGE);
    await picker(page).setInputFiles([
      { name: "tall.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([300], 2000)) },
      await pdf("b.pdf", [200]),
    ]);
    await mergeButton(page).click();
    await page.getByRole("button", { name: "Open page 1 larger" }).click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator("img")).toBeVisible();
    await expect.poll(() => viewer.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    for (const name of ["Close", "Zoom in", "Zoom out", "Fit to screen", "Previous page", "Next page", "Rotate left", "Rotate right", "Crop", "Move", "Remove this page"]) {
      await expect(viewer.getByRole("button", { name, exact: true })).toBeInViewport();
    }
    // Phones open the position box from the Move button.
    if (width < 600) await viewer.getByRole("button", { name: "Move", exact: true }).click();
    await expect(viewer.getByLabel("Move to position")).toBeInViewport();
    const image = await viewer.locator("img").boundingBox();
    const tools = await viewer.getByTestId("viewer-tools").boundingBox();
    expect((image?.y ?? 0) + (image?.height ?? 0)).toBeLessThanOrEqual((tools?.y ?? 0) + 1);
    const overflow = await viewer.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer-${width}.png` });
  });
}

test("viewer - buttons are in a set order with icons", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.getByRole("button", { name: "Open page 1 larger" }).click();
  const names = await page.getByTestId("viewer-tools").getByRole("button").evaluateAll((buttons) =>
    buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim()),
  );
  expect(names).toEqual(["Rotate left", "Rotate right", "Crop", "Move", "Remove this page"]);
  const withIcons = await page.getByTestId("viewer-tools").getByRole("button").evaluateAll((buttons) =>
    buttons.every((b) => b.querySelector("svg")),
  );
  expect(withIcons).toBe(true);
});

// --- Leaving the page ---

async function leaveAndCatchPrompt(page: Page) {
  let prompted = false;
  page.once("dialog", async (dialog) => {
    prompted = dialog.type() === "beforeunload";
    await dialog.accept();
  });
  await page.goto("/about/");
  return prompted;
}

test("leaving - warns when files are chosen but not merged", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
  await page.getByRole("heading", { name: "Arrange your files" }).click();
  expect(await leaveAndCatchPrompt(page)).toBe(true);
});

test("leaving - warns when the merged file hasn't been downloaded", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  expect(await leaveAndCatchPrompt(page)).toBe(true);
});

test("leaving - no warning once the merged file is downloaded", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /^Download merged\.pdf/ }).click();
  await pending;
  expect(await leaveAndCatchPrompt(page)).toBe(false);
});

test("leaving - warns again when downloaded pages are changed but not applied", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /^Download merged\.pdf/ }).click();
  await pending;
  await toolbar(page).getByRole("button", { name: "Rotate all" }).click();
  expect(await leaveAndCatchPrompt(page)).toBe(true);
});

test("leaving - no warning with nothing chosen", async ({ page }) => {
  await page.goto(PAGE);
  await page.locator("h1").click();
  expect(await leaveAndCatchPrompt(page)).toBe(false);
});

test("leaving - files and results are wiped when the page is hidden", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeHidden();
  await expect(picker(page)).toBeAttached();
  await expect(page.locator('.shell-pages img, [data-testid="shell-file"]')).toHaveCount(0);
  expect(await page.locator('[data-el="downloads"] a').count()).toBe(0);
});

test("start over - the larger view's image is released", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await page.getByRole("button", { name: "Open page 1 larger" }).click();
  await expect.poll(() => page.locator('[data-el="viewer-image"]').getAttribute("src")).toMatch(/^blob:/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start over" }).click();
  await page.getByRole("button", { name: "Yes, start over" }).click();
  expect(await page.locator('[data-el="viewer-image"]').getAttribute("src")).toBeNull();
});

test("merge pdf - guidance covers editing pages and leaving the page", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("step").nth(3)).toContainText("Check and fix the pages");
  await expect(page.getByTestId("tip-card").nth(1)).toContainText("Fix sideways scans");
  await page.locator("summary", { hasText: "What happens to my files when I leave the page?" }).click();
  await expect(page.getByText("pressing Back won't bring them back")).toBeVisible();
});

// --- Dragging files into order ---

async function dragRow(page: Page, from: number, to: number) {
  const rows = page.getByTestId("shell-file");
  // Keep the rows clear of the screen edges, where dragging scrolls the page.
  await page.locator('[data-el="list"]').evaluate((list) => list.scrollIntoView({ block: "center" }));
  const grip = await rows.nth(from).locator(".shell-file-grip").boundingBox();
  const target = await rows.nth(to).boundingBox();
  if (!grip || !target) throw new Error("Rows not found");
  const startX = grip.x + grip.width / 2;
  const startY = grip.y + grip.height / 2;
  // Aim above the middle of the target row to drop before it, or below to drop after it.
  const endY = to < from ? target.y + target.height * 0.25 : target.y + target.height * 0.75;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, (startY + endY) / 2, { steps: 5 });
  await page.mouse.move(startX, endY, { steps: 5 });
  await page.mouse.up();
}

const names = (page: Page) =>
  page.getByTestId("shell-file").locator(".shell-file-name").allTextContents();

test("drag files - every row has a grip to drag it", async ({ page }) => {
  await page.goto(PAGE);
  await manyFiles(page, 3);
  await expect(page.locator(".shell-file-grip")).toHaveCount(3);
  expect(await page.locator(".shell-file-grip").first().evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");
  await expect(page.getByText("Drag files, or use the arrows")).toBeVisible();
});

test("drag files - dragging a row up changes the merged order", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200]), await pdf("c.pdf", [300])]);
  await dragRow(page, 2, 0);
  expect(await names(page)).toEqual(["c.pdf", "a.pdf", "b.pdf"]);
  await expect(page.getByTestId("shell-live")).toContainText("c.pdf moved to position 1");
  expect(await mergeAndRead(page)).toEqual([300, 100, 200]);
});

test("drag files - dragging a row down works too", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(PAGE);
  await manyFiles(page, 4);
  await dragRow(page, 0, 2);
  expect(await names(page)).toEqual(["document-2.pdf", "document-3.pdf", "document-1.pdf", "document-4.pdf"]);
});

test("drag files - Alt and an arrow key move the focused row", async ({ page }) => {
  await page.goto(PAGE);
  await manyFiles(page, 3);
  const remove = page.getByRole("button", { name: "Remove document-3.pdf" });
  await remove.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  expect(await names(page)).toEqual(["document-3.pdf", "document-1.pdf", "document-2.pdf"]);
  await expect(remove).toBeFocused();
});

for (const width of [320, 768]) {
  test(`drag files - rows with grips fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(PAGE);
    await manyFiles(page, 3);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator(".shell-files").screenshot({ path: `${SCREENSHOT_DIR}/drag-rows-${width}.png` });
  });
}

// --- Page shapes in the preview grid ---

for (const colorScheme of ["light", "dark"] as const) {
  test(`preview grid - very tall and very wide pages stay inside their frames in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(PAGE);
    await picker(page).setInputFiles([
      { name: "tall.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([200], 1200)) },
      { name: "wide.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([1200], 200)) },
      await pdf("normal.pdf", [210]),
    ]);
    await mergeButton(page).click();
    await expect.poll(() => imagesLoaded(page, ".shell-pages img")).toEqual([true, true, true]);
    const fits = await page.locator(".shell-page-frame").evaluateAll((frames) =>
      frames.map((frame) => {
        const box = frame.getBoundingClientRect();
        const img = frame.querySelector("img")?.getBoundingClientRect();
        return Boolean(img) && img!.top >= box.top - 0.5 && img!.bottom <= box.bottom + 0.5 && img!.left >= box.left - 0.5 && img!.right <= box.right + 0.5;
      }),
    );
    expect(fits).toEqual([true, true, true]);
    const heights = await page.locator(".shell-page-item").evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
    await page.locator(".shell-pages").screenshot({ path: `${SCREENSHOT_DIR}/page-shapes-${colorScheme}.png` });
  });
}

// --- Showing more and fewer pages ---

test("preview grid - page count controls say exactly what they do", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([
    await pdf("a.pdf", Array.from({ length: 20 }, () => 100)),
    await pdf("b.pdf", Array.from({ length: 10 }, () => 200)),
  ]);
  await mergeButton(page).click();
  const controls = page.getByTestId("page-count");
  await expect(controls).toContainText("Showing 12 of 30 pages");
  const names = () => controls.getByRole("button").evaluateAll((buttons) =>
    buttons.filter((b) => !(b as HTMLElement).hidden).map((b) => b.textContent?.trim()),
  );
  expect(await names()).toEqual(["Show 12 more pages", "Show all 30 pages"]);
  await expect(controls.getByRole("button", { name: "Show 12 more pages" }).locator("svg")).toBeVisible();

  await controls.getByRole("button", { name: "Show 12 more pages" }).click();
  await expect(tiles(page)).toHaveCount(24);
  // The next batch reaches the end, so Show all would do the same thing and is hidden.
  expect(await names()).toEqual(["Show 6 more pages", "Show first 12 only"]);

  await controls.getByRole("button", { name: "Show first 12 only" }).click();
  await expect(tiles(page)).toHaveCount(12);
  await expect(controls.getByRole("button", { name: "Show 12 more pages" })).toBeFocused();

  await controls.getByRole("button", { name: "Show all 30 pages" }).click();
  await expect(tiles(page)).toHaveCount(30);
  await expect(controls).toContainText("Showing all 30 pages");
  expect(await names()).toEqual(["Show first 12 only"]);
  await page.getByTestId("page-count").screenshot({ path: `${SCREENSHOT_DIR}/page-count.png` });
});

test("preview grid - page count controls fit a phone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", Array.from({ length: 30 }, () => 100)), await pdf("b.pdf", [200])]);
  await mergeButton(page).click();
  await page.getByRole("button", { name: "Show 12 more pages" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByTestId("page-count").screenshot({ path: `${SCREENSHOT_DIR}/page-count-320.png` });
});

test("preview grid - short results need neither button", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await expect(page.getByRole("button", { name: /^Show \d+ more pages?$/ })).toBeHidden();
  await expect(page.getByTestId("page-count")).toBeHidden();
});

// --- Phone layout ---

test.describe("phone layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("pages show three to a row, and the keyboard tip is hidden", async ({ page }) => {
    await mergeForEditing(page, [100, 100], [200, 210]);
    await expect(page.locator(".shell-page-item")).toHaveCount(4);
    const tops = await page.locator(".shell-page-item").evaluateAll((items) =>
      items.slice(0, 3).map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
    await expect(page.locator('[data-el="page-tip"]')).toBeHidden();
    for (const box of await page.locator(".shell-page-check, [data-testid='page-toolbar'] button:visible").all()) {
      expect((await box.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("the download button fits on one line", async ({ page }) => {
    await mergeForEditing(page, [100], [200]);
    const link = page.getByRole("link", { name: /^Download merged\.pdf/ });
    expect((await link.boundingBox())?.height ?? 0).toBeLessThanOrEqual(56);
  });

  test("guidance cards put icons beside their titles", async ({ page }) => {
    await page.goto(PAGE);
    const step = page.getByTestId("step").first();
    const icon = await step.locator(".icon").boundingBox();
    const title = await step.locator("h3").boundingBox();
    expect(Math.abs((icon?.y ?? 0) + (icon?.height ?? 0) / 2 - ((title?.y ?? 0) + (title?.height ?? 0) / 2))).toBeLessThanOrEqual(6);
  });

  test("footer link columns sit side by side", async ({ page }) => {
    await page.goto("/");
    const columns = page.locator("footer .columns > div");
    const first = await columns.nth(0).boundingBox();
    const second = await columns.nth(1).boundingBox();
    expect(Math.abs((first?.y ?? 0) - (second?.y ?? 0))).toBeLessThanOrEqual(2);
  });
});

test("edit pages - with every page selected, only Rotate and Clear show", async ({ page }) => {
  await mergeForEditing(page, [100], [200, 210]);
  const bar = toolbar(page);
  await bar.getByRole("button", { name: "Select all" }).click();
  await expect(bar).toContainText("All 3 pages selected");
  await expect(bar.getByRole("button", { name: "Rotate", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  await expect(bar.getByText("Move to…")).toBeHidden();
  await expect(bar.getByRole("button", { name: "Remove", exact: true })).toBeHidden();
  await select(page, 2).uncheck();
  await expect(bar).toContainText("2 pages selected");
  await expect(bar.getByText("Move to…")).toBeVisible();
  await expect(bar.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await bar.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.locator("[data-select]:checked")).toHaveCount(0);
});

// --- Zoom and crop in the larger view ---

async function openLarger(page: Page, n: number) {
  await page.getByRole("button", { name: `Open page ${n} larger` }).click();
  const viewer = page.getByRole("dialog");
  await expect.poll(() => viewer.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  return viewer;
}

test("zoom - zooms in, out and back to fit", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  const width = () => viewer.locator('[data-el="viewer-canvas"]').evaluate((el) => el.getBoundingClientRect().width);
  const fit = await width();
  await expect(viewer.getByText("100%")).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.getByText("150%")).toBeVisible();
  expect(await width()).toBeCloseTo(fit * 1.5, 0);
  await page.keyboard.press("+");
  await expect(viewer.getByText("200%")).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom out" }).click();
  await expect(viewer.getByText("150%")).toBeVisible();
  await viewer.getByRole("button", { name: "Fit to screen" }).click();
  await expect(viewer.getByText("100%")).toBeVisible();
  expect(await width()).toBeCloseTo(fit, 0);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/zoom-fit.png` });
});

test("zoom - a zoomed page can be dragged around", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  const scroller = viewer.locator('[data-el="viewer-scroll"]');
  const before = await scroller.evaluate((el) => el.scrollTop);
  const box = await scroller.boundingBox();
  if (!box) throw new Error("No scroll area");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 150, { steps: 5 });
  await page.mouse.up();
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/zoom-300.png` });
});

test("crop - drag a corner, apply, and the PDF keeps only that area", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  const cropBox = viewer.getByRole("group", { name: "Crop area" });
  await expect(cropBox).toBeFocused();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/crop-start.png` });
  const canvas = await viewer.locator('[data-el="viewer-canvas"]').boundingBox();
  const handle = await cropBox.locator('[data-handle="se"]').boundingBox();
  if (!canvas || !handle) throw new Error("Crop box not found");
  // Drag the bottom-right corner to the middle of the page.
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 8 });
  await page.mouse.up();
  await viewer.getByRole("button", { name: "Apply crop" }).click();
  await expect(page.getByTestId("shell-live")).toContainText("Page 1 cropped");
  await expect(viewer.getByRole("button", { name: "Crop", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByText("You've changed the pages.")).toBeVisible();
  const [box] = await pageCropBoxes(await applyAndLoad(page));
  // The default box starts 5% in, so the kept area runs from 5% to the middle of the 200 x 300 page.
  expect(box[0]).toBeCloseTo(10, -1);
  expect(box[2]).toBeCloseTo(90, -1);
  expect(box[3]).toBeCloseTo(135, -1);
});

test("crop - the keyboard can move and resize the box", async ({ page }) => {
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  for (let i = 0; i < 20; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("shell-live")).toContainText("Page 1 cropped");
  await page.keyboard.press("Escape");
  const [box] = await pageCropBoxes(await applyAndLoad(page));
  expect(box[2]).toBeCloseTo(140, -1);
});

test("crop - cancel and Escape leave the page alone, and Remove crop undoes it", async ({ page }) => {
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("group", { name: "Crop area" })).toBeHidden();
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  await viewer.getByRole("button", { name: "Apply crop" }).click();
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  await viewer.getByRole("button", { name: "Remove crop" }).click();
  await expect(page.getByTestId("shell-live")).toContainText("Crop removed from page 1");
  await page.keyboard.press("Escape");
  await expect(page.getByText("You've changed the pages.")).toBeHidden();
});

test("crop - a crop follows the page when it's turned afterwards", async ({ page }) => {
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  await viewer.getByRole("button", { name: "Apply crop" }).click();
  await viewer.getByRole("button", { name: "Rotate right" }).click();
  await page.keyboard.press("Escape");
  const bytes = await applyAndLoad(page);
  expect(await pageRotations(bytes)).toEqual([90, 0]);
  const [box] = await pageCropBoxes(bytes);
  expect(box[2]).toBeCloseTo(180, -1);
  expect(box[3]).toBeCloseTo(270, -1);
});

test("crop - the thumbnail shows the cropped page", async ({ page }) => {
  await mergeForEditing(page, [200], [200]);
  const thumb = page.locator('.shell-page-item[data-page="1"] img');
  await expect.poll(() => thumb.evaluate((img) => (img as HTMLImageElement).naturalHeight > (img as HTMLImageElement).naturalWidth)).toBe(true);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  for (let i = 0; i < 50; i++) await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect.poll(() => page.locator('.shell-page-item[data-page="1"] img').evaluate((img) => (img as HTMLImageElement).naturalWidth > (img as HTMLImageElement).naturalHeight)).toBe(true);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`crop - crop mode has no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await mergeForEditing(page, [200], [200]);
    const viewer = await openLarger(page, 1);
    await viewer.getByRole("button", { name: "Crop", exact: true }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}

test("crop - crop mode fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await mergeForEditing(page, [200], [200]);
  const viewer = await openLarger(page, 1);
  await viewer.getByRole("button", { name: "Crop", exact: true }).click();
  for (const name of ["Cancel", "Apply crop"]) await expect(viewer.getByRole("button", { name })).toBeInViewport();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/crop-375.png` });
});
