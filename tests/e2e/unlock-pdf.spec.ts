import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { IN, OUT } from "../../src/lib/pdf/qpdf";
import { nodeQpdf } from "../../src/lib/pdf/qpdf-node.test-helper";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/unlock-pdf";
const PAGE = "/unlock-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A PDF that asks for `password` to open, or one that opens freely but blocks printing and copying.
async function lockedPdf(name: string, password: string, pages = 2): Promise<Upload> {
  const { output } = await nodeQpdf(["--encrypt", `--user-password=${password}`, `--owner-password=${password}`, "--bits=256", "--", IN, OUT], await makePdf(Array(pages).fill(200), 300));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(output as Uint8Array) };
}
async function restrictedPdf(name: string): Promise<Upload> {
  const { output } = await nodeQpdf(["--encrypt", "--user-password=", "--owner-password=owner", "--bits=256", "--print=none", "--extract=n", "--", IN, OUT], await makePdf([200], 300));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(output as Uint8Array) };
}
const plainPdf = async (name: string): Promise<Upload> => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf([200], 300)) });

const runButton = (page: Page) => page.getByRole("button", { name: "Unlock PDF", exact: true });
const cards = (page: Page) => page.getByTestId("unlock-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function unlockAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("unlock pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Unlock PDF" })).toBeVisible();
  for (const heading of ["How to remove a password from a PDF", "How unlocking works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/unlock-pdf.png");
});

test("unlock pdf - asks for the password, then removes it", async ({ page }) => {
  await choose(page, [await lockedPdf("statement.pdf", "০১-জানু 1990")]);
  await expect(cards(page)).toContainText("Needs its password");
  await expect(page.getByTestId("unlock-status")).toHaveText("Type the password for statement.pdf first.");
  await expect(runButton(page)).toBeDisabled();
  await page.getByLabel("Password for statement.pdf").fill("০১-জানু 1990");
  await expect(runButton(page)).toBeEnabled();
  const { name, bytes } = await unlockAndDownload(page);
  expect(name).toBe("statement_unlocked.pdf");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  // Unlocked files can be previewed.
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("unlock pdf - a wrong password says so, and the right one then works", async ({ page }) => {
  await choose(page, [await lockedPdf("payslip.pdf", "Right")]);
  await page.getByLabel("Password for payslip.pdf").fill("right");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("That password doesn't open payslip.pdf.");
  await page.getByLabel("Password for payslip.pdf").fill("Right");
  const { bytes } = await unlockAndDownload(page);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
});

test("unlock pdf - print and copy limits go without a password, and an open file is pointed out", async ({ page }) => {
  await choose(page, [await restrictedPdf("form.pdf")]);
  await expect(cards(page)).toContainText("No password needed: limits will be removed");
  await expect(page.getByLabel("Password for form.pdf")).toHaveCount(0);
  const { bytes } = await unlockAndDownload(page);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);

  await choose(page, [await plainPdf("open.pdf")]);
  await expect(cards(page)).toContainText("Not protected");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("open.pdf isn't protected");
});

test("unlock pdf - several PDFs, each with its own password, come in one ZIP", async ({ page }) => {
  await choose(page, [await lockedPdf("a.pdf", "alpha", 1), await restrictedPdf("b.pdf"), await lockedPdf("c.pdf", "gamma", 3)]);
  await page.getByLabel("Password for a.pdf").fill("alpha");
  await expect(page.getByTestId("unlock-status")).toHaveText("Type the password for c.pdf first.");
  await page.getByLabel("Password for c.pdf").fill("gamma");
  const { name, bytes } = await unlockAndDownload(page);
  expect(name).toBe("anytools_unlocked.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["a_unlocked.pdf", "b_unlocked.pdf", "c_unlocked.pdf"]);
  expect((await PDFDocument.load(files["c_unlocked.pdf"])).getPageCount()).toBe(3);
});

for (const width of [320, 375, 768, 1366]) {
  test(`unlock pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await lockedPdf("a-long-file-name-that-should-not-overflow.pdf", "x"), await restrictedPdf("b.pdf")]);
    await page.getByLabel("Password for a-long-file-name-that-should-not-overflow.pdf").fill("x");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`unlock pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await lockedPdf("a.pdf", "x")]);
    await expect(page.getByLabel("Password for a.pdf")).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Password for a.pdf").fill("x");
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
