import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/protect-pdf";
const PAGE = "/protect-pdf/";

const pdf = async (name: string, widths: number[]) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf(widths, 300)) });

const panel = (page: Page) => page.getByTestId("protect-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Protect PDF", exact: true });
const password = (page: Page) => panel(page).getByLabel("Password", { exact: true });
const repeat = (page: Page) => panel(page).getByLabel("Repeat password");

async function choose(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(page.getByTestId("protect-card")).toHaveCount(files.length);
}

async function protectAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// Opens a PDF with pdf.js the way a reader would: with the password, or without.
async function pagesWith(bytes: Uint8Array, secret?: string) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password: secret });
  try {
    return (await task.promise).numPages;
  } catch (error) {
    return (error as Error).name;
  } finally {
    await task.destroy();
  }
}

test("protect pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Protect PDF" })).toBeVisible();
  for (const heading of ["How to password protect a PDF", "How protecting works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/protect-pdf.png");
});

test("protect pdf - waits for the same password twice, and shows how strong it is", async ({ page }) => {
  await choose(page, [await pdf("contract.pdf", [200, 200])]);
  await expect(runButton(page)).toBeDisabled();
  await password(page).fill("sunflower7");
  await expect(panel(page)).toContainText("Strength: Fair.");
  await repeat(page).fill("sunflower");
  await expect(page.getByTestId("protect-check")).toHaveText("The passwords don't match yet.");
  await expect(repeat(page)).toHaveAttribute("aria-invalid", "true");
  await expect(runButton(page)).toBeDisabled();
  await repeat(page).fill("sunflower7");
  await expect(page.getByTestId("protect-check")).toHaveText("The passwords match.");
  await expect(runButton(page)).toBeEnabled();
  // The eye button shows what was typed.
  await panel(page).getByRole("button", { name: "Show password" }).first().click();
  await expect(password(page)).toHaveAttribute("type", "text");
  await expect(panel(page).getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
});

test("protect pdf - the result opens only with the password", async ({ page }) => {
  await choose(page, [await pdf("contract.pdf", [200, 200])]);
  await password(page).fill("গোপন কথা 42");
  await repeat(page).fill("গোপন কথা 42");
  const { name, bytes } = await protectAndDownload(page);
  expect(name).toBe("contract_protected.pdf");
  expect(await pagesWith(bytes)).toBe("PasswordException");
  expect(await pagesWith(bytes, "wrong")).toBe("PasswordException");
  expect(await pagesWith(bytes, "গোপন কথা 42")).toBe(2);
  await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/);
});

test("protect pdf - several PDFs come in one ZIP, all with the same password", async ({ page }) => {
  await choose(page, [await pdf("a.pdf", [200]), await pdf("b.pdf", [200, 200, 200])]);
  await password(page).fill("correct horse battery");
  await repeat(page).fill("correct horse battery");
  const { name, bytes } = await protectAndDownload(page);
  expect(name).toBe("anytools_protected.zip");
  const files = unzipSync(bytes);
  expect(Object.keys(files)).toEqual(["a_protected.pdf", "b_protected.pdf"]);
  expect(await pagesWith(files["b_protected.pdf"], "correct horse battery")).toBe(3);
});

test("protect pdf - a file with a password already says to unlock it first", async ({ page }) => {
  await choose(page, [await pdf("a.pdf", [200])]);
  await password(page).fill("first");
  await repeat(page).fill("first");
  const { bytes } = await protectAndDownload(page);
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) }]);
  await expect(page.getByTestId("protect-card")).toContainText("Has a password already");
  await password(page).fill("second");
  await repeat(page).fill("second");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf already has a password. Unlock it first");
});

for (const width of [320, 375, 768, 1366]) {
  test(`protect pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await pdf("a-long-file-name-that-should-not-overflow.pdf", [200]), await pdf("b.pdf", [400])]);
    await password(page).fill("a password");
    await repeat(page).fill("a password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`protect pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await pdf("a.pdf", [200])]);
    await password(page).fill("abc");
    await repeat(page).fill("abd");
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await repeat(page).fill("abc");
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
