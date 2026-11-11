import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/ocr-pdf";
const PAGE = "/ocr-pdf/";
// Reading a page takes a few seconds, more while other tests share the machine.
const READ_TIMEOUT = 90_000;

type Upload = { name: string; mimeType: string; buffer: Buffer };

const BANGLA_FONT = "node_modules/@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff2";

// A photographed page of printed text, as a picture: what a scanner or phone makes. Drawn in a browser so Bangla letters
// join properly, at twice the size so it's sharp, like a 200 dpi scan.
async function scanOf(browser: Browser, lines: string[]): Promise<Buffer> {
  const font = (await readFile(BANGLA_FONT)).toString("base64");
  const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 600, height: 800 } });
  const sheet = await context.newPage();
  await sheet.setContent(`
    <style>
      @font-face { font-family: Bangla; src: url(data:font/woff2;base64,${font}) format("woff2"); }
      body { margin: 0; }
      main { width: 600px; height: 800px; padding: 60px; box-sizing: border-box; background: #fff;
        font: 26px/1.8 Helvetica, Arial, Bangla, sans-serif; color: #111; }
    </style>
    <main>${lines.map((line) => `<p>${line}</p>`).join("")}</main>`);
  await sheet.evaluate(() => document.fonts.ready);
  const png = await sheet.locator("main").screenshot();
  await context.close();
  return png;
}

// A PDF made only of pictures of its pages, like a scan, so it has no text to select.
async function scannedPdf(browser: Browser, name: string, pages: string[][], turn = 0): Promise<Upload> {
  const doc = await PDFDocument.create();
  for (const lines of pages) {
    const picture = await doc.embedPng(await scanOf(browser, lines));
    if (turn) {
      // Stored sideways and shown upright by the page's turn, as some scanners save pages.
      const page = doc.addPage([400, 300]);
      page.setRotation(degrees(turn));
      page.drawImage(picture, { x: 400, y: 0, width: 300, height: 400, rotate: degrees(90) });
    } else {
      doc.addPage([300, 400]).drawImage(picture, { x: 0, y: 0, width: 300, height: 400 });
    }
  }
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// A PDF whose page already has real text, as made by a word processor.
async function typedPdf(name: string): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 400]).drawText("This letter was typed, so its words can already be searched.", { x: 20, y: 360, size: 9, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const { items } = await (await doc.getPage(number)).getTextContent();
    pages.push(items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
  }
  return pages;
}

const runButton = (page: Page) => page.getByRole("button", { name: "OCR PDF", exact: true });
const cards = (page: Page) => page.getByTestId("ocr-card");
const language = (page: Page, name: string) => page.getByTestId("ocr-options").getByRole("checkbox", { name });

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function readAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: READ_TIMEOUT });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("ocr pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "OCR PDF" })).toBeVisible();
  for (const heading of ["How to make a scanned PDF searchable", "How OCR works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/ocr-pdf.png");
});

test("ocr pdf - a scanned page becomes searchable, looking and sized as before", async ({ page, browser }) => {
  test.slow();
  const scan = await scannedPdf(browser, "receipt.pdf", [["Invoice number 4821", "Total amount due: 1250 taka", "Thank you for your order"]]);
  await choose(page, [scan]);
  await expect(cards(page)).toContainText("1 page");
  await language(page, "বাংলা (Bangla)").uncheck();
  // Nothing goes out but requests for this site's own reader files, each language once. Blob and data addresses never
  // leave the browser.
  const site = new URL(page.url()).origin;
  const requests: string[] = [];
  const languages: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/^(blob|data):/.test(url)) return;
    if (request.method() !== "GET" || new URL(url).origin !== site) requests.push(`${request.method()} ${url}`);
    if (url.includes(".traineddata")) languages.push(url);
  });
  const { name, bytes } = await readAndDownload(page);
  expect(requests).toEqual([]);
  expect(languages).toEqual([`${site}/ocr/4.0.0_best_int/eng.traineddata.gz`]);
  expect(name).toBe("receipt_ocr.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("receipt.pdf can now be searched and copied.");
  const [text] = await textOf(bytes);
  for (const word of ["Invoice", "4821", "Total", "1250", "order"]) expect(text).toContain(word);
  // The page and its picture are untouched; only a few kilobytes of text are added.
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPages().map((one) => [one.getWidth(), one.getHeight()])).toEqual([[300, 400]]);
  expect(bytes.length).toBeLessThan(scan.buffer.length + 20 * 1024);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("ocr pdf - Bangla and English on one page are both read", async ({ page, browser }) => {
  test.slow();
  await choose(page, [await scannedPdf(browser, "letter.pdf", [["আমার সোনার বাংলা", "আমি তোমায় ভালোবাসি", "Dhaka 2026"]])]);
  await expect(language(page, "English")).toBeChecked();
  await expect(language(page, "বাংলা (Bangla)")).toBeChecked();
  const { bytes } = await readAndDownload(page);
  const [text] = await textOf(bytes);
  for (const word of ["আমার", "সোনার", "বাংলা", "Dhaka", "2026"]) expect(text).toContain(word);
});

test("ocr pdf - a turned page is read the right way up", async ({ page, browser }) => {
  test.slow();
  await choose(page, [await scannedPdf(browser, "turned.pdf", [["Delivery note 7710", "Received with thanks"]], 90)]);
  await language(page, "বাংলা (Bangla)").uncheck();
  const { bytes } = await readAndDownload(page);
  const [text] = await textOf(bytes);
  expect(text).toContain("Delivery");
  expect(text).toContain("7710");
});

test("ocr pdf - pages with text are kept, and several PDFs come in one ZIP", async ({ page, browser }) => {
  test.slow();
  await choose(page, [await scannedPdf(browser, "scan.pdf", [["Meeting notes for Monday"]]), await typedPdf("typed.pdf")]);
  await language(page, "বাংলা (Bangla)").uncheck();
  const { name, bytes } = await readAndDownload(page);
  expect(name).toBe("anytools_ocr.zip");
  await expect(page.getByTestId("shell-result-card")).toContainText("Read 1 page in 2 PDFs.");
  const files = unzipSync(bytes);
  expect(Object.keys(files).sort()).toEqual(["scan_ocr.pdf", "typed_ocr.pdf"]);
  expect((await textOf(files["scan_ocr.pdf"]))[0]).toContain("Meeting");
  // Its own text, once: nothing read on top of it.
  expect(await textOf(files["typed_ocr.pdf"])).toEqual(["This letter was typed, so its words can already be searched."]);
  await expect(page.getByText("typed.pdf, already had text")).toBeVisible();
});

test("ocr pdf - the run waits for a language, and the choice is remembered", async ({ page }) => {
  await choose(page, [await typedPdf("a.pdf")]);
  await language(page, "English").uncheck();
  await language(page, "বাংলা (Bangla)").uncheck();
  await expect(runButton(page)).toBeDisabled();
  await expect(page.getByTestId("ocr-options").getByRole("status")).toHaveText("Choose at least one language.");
  await language(page, "বাংলা (Bangla)").check();
  await expect(runButton(page)).toBeEnabled();
  await choose(page, [await typedPdf("b.pdf")]);
  await expect(language(page, "English")).not.toBeChecked();
  await expect(language(page, "বাংলা (Bangla)")).toBeChecked();
});

test("ocr pdf - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`ocr pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await typedPdf("a-long-file-name-that-should-not-overflow.pdf"), await typedPdf("b.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`ocr pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await typedPdf("a.pdf")]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: READ_TIMEOUT });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
