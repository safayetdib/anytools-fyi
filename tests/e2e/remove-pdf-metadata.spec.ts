import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/remove-pdf-metadata";
const PAGE = "/remove-pdf-metadata/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A CV with its author's name and apps in its details, and a phone photo with its Exif section.
async function cv(name = "cv.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.setTitle("My CV");
  doc.setAuthor("Rahim Uddin");
  doc.setCreator("Word");
  const page = doc.addPage([400, 400]);
  page.drawText("Rahim's CV", { x: 50, y: 350, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  page.drawImage(await doc.embedJpg(await readFile("tests/fixtures/images/phone.jpg")), { x: 50, y: 50, width: 200, height: 150 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save({ useObjectStreams: false })) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Remove metadata", exact: true });
const cards = (page: Page) => page.getByTestId("meta-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function cleanAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("remove pdf metadata - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Remove PDF metadata" })).toBeVisible();
  for (const heading of ["How to remove metadata from a PDF", "How removing metadata works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/remove-pdf-metadata.png");
});

test("remove pdf metadata - each card shows its details, and they're all removed", async ({ page }) => {
  await choose(page, [await cv()]);
  await expect(cards(page)).toContainText("Has: title, author, app names, dates");
  const { name, bytes } = await cleanAndDownload(page);
  expect(name).toBe("cv_clean.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText(
    "Removed the title, the author, the names of the apps that made it, the dates it was made and changed and camera and place details in its photos from cv.pdf",
  );
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const { info, metadata } = (await doc.getMetadata()) as { info: Record<string, unknown>; metadata: unknown };
  expect([info.Title, info.Author, info.Creator, info.Producer, info.CreationDate]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  expect(metadata).toBeNull();
  const text = (await (await doc.getPage(1)).getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
  expect(text).toBe("Rahim's CV");
  expect(new TextDecoder("latin1").decode(bytes)).not.toContain("Exif");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("remove pdf metadata - several PDFs come in a ZIP", async ({ page }) => {
  await choose(page, [await cv("a.pdf"), await cv("b.pdf")]);
  const { name, bytes } = await cleanAndDownload(page);
  expect(name).toBe("anytools_remove-pdf-metadata.zip");
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["a_clean.pdf", "b_clean.pdf"]);
});

test("remove pdf metadata - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`remove pdf metadata - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await cv("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`remove pdf metadata - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await cv()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
