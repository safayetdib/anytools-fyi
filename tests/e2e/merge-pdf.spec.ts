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
