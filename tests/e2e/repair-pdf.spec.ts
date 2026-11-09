import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { IN, OUT } from "../../src/lib/pdf/qpdf";
import { nodeQpdf } from "../../src/lib/pdf/qpdf-node.test-helper";
import { damage } from "../fixtures/damage";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/repair-pdf";
const PAGE = "/repair-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A PDF saved the classic way, so its table of where objects start can be damaged.
async function classic(widths: number[]) {
  return (await PDFDocument.load(await makePdf(widths, 300))).save({ useObjectStreams: false });
}
const healthy = async (name: string, widths = [200, 300]): Promise<Upload> => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await classic(widths)) });
const damaged = async (name: string, widths = [200, 300, 400]): Promise<Upload> => ({ name, mimeType: "application/pdf", buffer: Buffer.from(damage(await classic(widths))) });
// Cut off before its table, like a download that stopped early.
async function cutShort(name: string): Promise<Upload> {
  const text = Buffer.from(await classic([200, 300])).toString("latin1");
  return { name, mimeType: "application/pdf", buffer: Buffer.from(text.slice(0, text.lastIndexOf("xref")), "latin1") };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Repair PDF", exact: true });
const cards = (page: Page) => page.getByTestId("repair-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function repairAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("repair pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Repair PDF" })).toBeVisible();
  for (const heading of ["How to repair a damaged PDF", "How repairing works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/repair-pdf.png");
});

test("repair pdf - a damaged file is rebuilt with all its pages, and previewed", async ({ page }) => {
  await choose(page, [await damaged("invoice.pdf")]);
  await expect(runButton(page)).toBeEnabled();
  const { name, bytes } = await repairAndDownload(page);
  expect(name).toBe("invoice_repaired.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("invoice.pdf is repaired.");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPages().map((one) => one.getWidth())).toEqual([200, 300, 400]);
  // The rebuilt file passes qpdf's own check.
  expect((await nodeQpdf(["--check", IN], bytes)).code).toBe(0);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("repair pdf - a file cut short, like a stopped download, opens again", async ({ page }) => {
  await choose(page, [await cutShort("download.pdf")]);
  const { bytes } = await repairAndDownload(page);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
});

test("repair pdf - a healthy file comes back as a clean copy", async ({ page }) => {
  await choose(page, [await healthy("fine.pdf")]);
  await expect(cards(page)).toContainText("Opens now; will be tidied");
  await repairAndDownload(page);
  await expect(page.getByTestId("shell-result-card")).toContainText("fine.pdf had no damage to repair.");
});

test("repair pdf - several files come in one ZIP, saying which needed repairs", async ({ page }) => {
  await choose(page, [await damaged("a.pdf"), await healthy("b.pdf")]);
  const { name, bytes } = await repairAndDownload(page);
  expect(name).toBe("anytools_repaired.zip");
  expect(Object.keys(unzipSync(bytes))).toEqual(["a_repaired.pdf", "b_repaired.pdf"]);
  await expect(page.getByTestId("shell-result-card")).toContainText("1 of 2 PDFs needed repairs.");
});

test("repair pdf - a file with a password, or not a PDF, says what to do", async ({ page }) => {
  const locked = await nodeQpdf(["--encrypt", "--user-password=x", "--owner-password=x", "--bits=256", "--", IN, OUT], await makePdf([200], 300));
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(locked.output as Uint8Array) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");

  await choose(page, [{ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text, not a PDF") }]);
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("notes.pdf is too damaged to repair, or isn't a PDF.");
});

for (const width of [320, 375, 768, 1366]) {
  test(`repair pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await damaged("a-long-file-name-that-should-not-overflow.pdf"), await healthy("b.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`repair pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await damaged("a.pdf")]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
