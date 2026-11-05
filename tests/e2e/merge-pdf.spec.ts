import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeEncryptedPdf, makePdf, pageWidths } from "../fixtures/pdf";

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
  for (const heading of ["How to merge PDF files", "Limits", "Questions"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Does this upload my files?" })).toBeVisible();
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
