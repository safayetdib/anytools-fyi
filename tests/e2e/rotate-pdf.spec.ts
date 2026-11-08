import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { makeEncryptedPdf, makePdf, pageRotations } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/rotate-pdf";
const PAGE = "/rotate-pdf/";

// Widths under 300 make upright (portrait) pages; wider ones make sideways (landscape) pages.
const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const panel = (page: Page) => page.getByTestId("rotate-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Rotate PDF", exact: true });
const card = (page: Page, name: string) => page.getByTestId("rotate-card").filter({ hasText: name });
const turn = (page: Page, name: string) => card(page, name).getAttribute("data-turn");

async function choose(page: Page, files: { name: string; widths: number[] }[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(await Promise.all(files.map(({ name, widths }) => pdf(name, widths))));
  await expect(page.getByTestId("rotate-card")).toHaveCount(files.length);
  await expect(page.getByTestId("rotate-card").locator("img")).toHaveCount(files.length);
}

async function rotateAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("rotate pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Rotate PDF" })).toBeVisible();
  await expect(picker(page)).toBeAttached();
  for (const heading of ["How to rotate a PDF", "How rotating works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/rotate-pdf/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/rotate-pdf.png");
});

test("rotate pdf - starts like other tools: the note, Right and Left, and the button off", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102] }]);
  await expect(panel(page).getByRole("heading", { name: "Rotate PDF" })).toBeVisible();
  await expect(panel(page)).toContainText("Select the rotate button on a file to turn it, or turn every file at once.");
  await expect(panel(page).getByRole("button", { name: "Right" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Left" })).toBeVisible();
  // One file has nothing to filter, so the file choice and Reset all stay hidden.
  await expect(panel(page).getByRole("radio", { name: "Portrait" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Reset all" })).toBeHidden();
  await expect(runButton(page)).toBeDisabled();
});

test("rotate pdf - one file turned right is downloaded with every page turned", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101, 102, 103] }]);
  await panel(page).getByRole("button", { name: "Right" }).click();
  expect(await turn(page, "report.pdf")).toBe("90");
  await expect(runButton(page)).toBeEnabled();
  const { name, bytes } = await rotateAndDownload(page);
  expect(name).toBe("report_rotated.pdf");
  expect(await pageRotations(bytes)).toEqual([90, 90, 90]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("rotate pdf - each file's own button turns just that file, and Left turns them back", async ({ page }) => {
  await choose(page, [
    { name: "a.pdf", widths: [101] },
    { name: "b.pdf", widths: [102] },
  ]);
  await page.getByRole("button", { name: "Rotate b.pdf" }).click();
  await page.getByRole("button", { name: "Rotate b.pdf" }).click();
  expect([await turn(page, "a.pdf"), await turn(page, "b.pdf")]).toEqual(["0", "180"]);
  await panel(page).getByRole("button", { name: "Left" }).click();
  expect([await turn(page, "a.pdf"), await turn(page, "b.pdf")]).toEqual(["270", "90"]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/turned.png`, fullPage: true });
});

test("rotate pdf - Portrait and Landscape turn only those files", async ({ page }) => {
  await choose(page, [
    { name: "tall.pdf", widths: [200] },
    { name: "wide.pdf", widths: [450] },
  ]);
  await panel(page).getByRole("radio", { name: "Landscape" }).check();
  await panel(page).getByRole("button", { name: "Right" }).click();
  expect([await turn(page, "tall.pdf"), await turn(page, "wide.pdf")]).toEqual(["0", "90"]);
  await panel(page).getByRole("radio", { name: "Portrait" }).check();
  await panel(page).getByRole("button", { name: "Left" }).click();
  expect([await turn(page, "tall.pdf"), await turn(page, "wide.pdf")]).toEqual(["270", "90"]);
  await panel(page).getByRole("button", { name: "Reset all" }).click();
  expect([await turn(page, "tall.pdf"), await turn(page, "wide.pdf")]).toEqual(["0", "0"]);
  await expect(runButton(page)).toBeDisabled();
});

test("rotate pdf - several files come in one ZIP, leaving out files that weren't turned", async ({ page }) => {
  await choose(page, [
    { name: "a.pdf", widths: [101, 102] },
    { name: "b.pdf", widths: [103] },
    { name: "c.pdf", widths: [104] },
  ]);
  await page.getByRole("button", { name: "Rotate a.pdf" }).click();
  await page.getByRole("button", { name: "Rotate c.pdf" }).click();
  const { name, bytes } = await rotateAndDownload(page);
  expect(name).toBe("anytools_rotated.zip");
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files)).toEqual(["a_rotated.pdf", "c_rotated.pdf"]);
  expect(await pageRotations(files["a_rotated.pdf"])).toEqual([90, 90]);
  await expect(page.getByTestId("shell-part")).toHaveCount(2);
  await expect(page.getByTestId("shell-result-card")).toContainText("b.pdf wasn't turned");
});

test("rotate pdf - password-protected files are flagged and explained", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(page.getByTestId("shell-file")).toContainText("Has a password");
});

test("rotate pdf - files can be turned with the keyboard", async ({ page }) => {
  await choose(page, [{ name: "report.pdf", widths: [101] }]);
  await page.getByRole("button", { name: "Rotate report.pdf" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await turn(page, "report.pdf")).toBe("180");
});

for (const width of [320, 375, 768, 1366]) {
  test(`rotate pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [
      { name: "a-long-file-name-that-should-wrap.pdf", widths: [101] },
      { name: "wide.pdf", widths: [450] },
    ]);
    await expect(panel(page).getByRole("heading", { name: "Rotate PDF" })).toBeInViewport();
    await panel(page).getByRole("button", { name: "Right" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(2, { timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`rotate pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await pdf("a.pdf", [101]), await pdf("b.pdf", [450])]);
    await expect(page.getByTestId("rotate-card").locator("img")).toHaveCount(2);
    await page.getByRole("button", { name: "Rotate a.pdf" }).click();
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await page.getByRole("button", { name: "Rotate b.pdf" }).click();
    await runButton(page).click();
    await expect(page.getByTestId("shell-part")).toHaveCount(2, { timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}

test("rotate pdf - phones get Rotate's own hint, not the reordering one", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await choose(page, [
    { name: "a.pdf", widths: [101] },
    { name: "b.pdf", widths: [450] },
  ]);
  await expect(page.getByText("Turn each file with its rotate button, or turn them all at once.")).toBeVisible();
  await expect(page.getByText("The top file goes first.")).toBeHidden();
  // Each filter label fits inside its box.
  for (const name of ["All", "Portrait", "Landscape"]) {
    const label = panel(page).locator("label").filter({ hasText: name });
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
});
