import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-word";
const PAGE = "/pdf-to-word/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A letter with a bold heading, a paragraph that wraps, a photo, and a second page turned sideways.
async function letter(name = "letter.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await doc.embedJpg(await readFile("tests/fixtures/images/wide.jpg"));
  const first = doc.addPage([612, 792]);
  first.drawText("Lease terms", { x: 72, y: 700, size: 18, font: bold });
  const lines = ["Rent is due on the fifth day of each month, paid by bank transfer to the", "landlord's account. Late rent costs a little extra each week."];
  // The first line is stretched to the right margin, the way a word processor wraps text.
  const width = font.widthOfTextAtSize(lines[0], 12);
  first.drawText(lines[0], { x: 72, y: 670, size: 12, font, wordBreaks: [" "] });
  first.drawText(lines[1], { x: 72, y: 655, size: 12, font });
  first.drawImage(photo, { x: 72, y: 400, width: 240, height: 160 });
  first.drawText("Signed in Dhaka.", { x: 72, y: 370, size: 12, font });
  const second = doc.addPage([842, 595]);
  second.drawText("Page two, sideways.", { x: 72, y: 500, size: 12, font });
  expect(width).toBeGreaterThan(300);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// Only a picture on its page, like a scan.
async function scan(name = "scan.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const photo = await doc.embedJpg(await readFile("tests/fixtures/images/wide.jpg"));
  doc.addPage([400, 300]).drawImage(photo, { x: 0, y: 0, width: 400, height: 300 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to Word", exact: true });
const cards = (page: Page) => page.getByTestId("word-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^(Your file is ready|Your \d+ files are ready)$/ })).toBeVisible({ timeout: 30000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

const bodyOf = (files: Record<string, Uint8Array>) => new TextDecoder().decode(files["word/document.xml"]);
const textOf = (body: string) => [...body.matchAll(/<w:p>(.*?)<\/w:p>/g)].map(([, p]) => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(([, t]) => t).join("")).filter(Boolean);

test("pdf to word - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to Word" })).toBeVisible();
  for (const heading of ["How to convert a PDF to Word", "How converting to Word works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-word.png");
});

test("pdf to word - text comes out as paragraphs with its fonts, with the photo in its place", async ({ page }) => {
  await choose(page, [await letter()]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("letter.docx");
  await expect(page.getByTestId("shell-result-card")).toContainText("letter.docx");
  const files = unzipSync(bytes);
  const body = bodyOf(files);
  expect(textOf(body)).toEqual([
    "Lease terms",
    "Rent is due on the fifth day of each month, paid by bank transfer to the landlord's account. Late rent costs a little extra each week.",
    "Signed in Dhaka.",
    "Page two, sideways.",
  ]);
  expect(body).toContain('w:ascii="Arial"');
  expect(body).toContain('w:ascii="Times New Roman"');
  expect(body).toContain("<w:b/>");
  // Two sections, each at its page's size; the second turned sideways.
  expect(body).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
  expect(body).toContain('<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"/>');
  const media = Object.keys(files).filter((file) => file.startsWith("word/media/"));
  expect(media).toHaveLength(1);
  expect(media[0]).toMatch(/\.jpeg$/);
  // The photo sits between the paragraph and the signature.
  expect(body.indexOf("<wp:inline")).toBeGreaterThan(body.indexOf("each week."));
  expect(body.indexOf("<wp:inline")).toBeLessThan(body.indexOf("Signed in Dhaka."));
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("pdf to word - several PDFs come in a ZIP, and a scan says to run OCR first", async ({ page }) => {
  await choose(page, [await letter("a.pdf"), await scan("b.pdf")]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pdf-to-word.zip");
  const zip = unzipSync(bytes);
  expect(Object.keys(zip).sort()).toEqual(["a.docx", "b.docx"]);
  const scanned = unzipSync(zip["b.docx"]);
  expect(Object.keys(scanned).some((file) => file.startsWith("word/media/"))).toBe(true);
  await expect(page.getByTestId("shell-result-card")).toContainText("Run OCR PDF on those first");
});

test("pdf to word - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to word - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await letter("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to word - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await letter()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 30000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
