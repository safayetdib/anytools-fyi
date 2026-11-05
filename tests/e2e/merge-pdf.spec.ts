import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeEncryptedPdf, makePdf, pageRotations, pageSizes, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/merge-pdf";
const PAGE = "/merge-pdf/";

const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const mergeButton = (page: Page) => page.getByRole("button", { name: "Merge PDF" });

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
  for (const heading of ["How to merge PDF files", "Limits", "How merging works", "Before you merge", "Why your files stay private", "Questions"]) {
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
  await expect(page.getByText("The merged file follows this order")).toBeVisible();
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
  await expect(page.getByText("Showing 12 of 30 pages.")).toBeVisible();
  await page.getByRole("button", { name: "Show more pages" }).click();
  await expect(thumbs).toHaveCount(24);
  await page.getByRole("button", { name: "Show more pages" }).click();
  await expect(thumbs).toHaveCount(30);
  await expect(page.getByRole("button", { name: "Show more pages" })).toBeHidden();
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
  await expect(steps).toHaveCount(4);
  await expect(steps.first()).toContainText("Select your PDFs");
  await expect(page.getByTestId("tip-card")).toHaveCount(3);
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
  await expect(page.getByRole("button", { name: "Show more pages" })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Show more pages" })).toBeVisible();
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

test("edit pages - every page can't be removed", async ({ page }) => {
  await mergeForEditing(page, [100], [200]);
  await toolbar(page).getByRole("button", { name: "Select all" }).click();
  await toolbar(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(tiles(page)).toHaveCount(2);
  await expect(page.getByTestId("shell-live")).toContainText("needs at least one page");
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
