import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, StandardFonts, TextRenderingMode, rgb, setTextRenderingMode } from "pdf-lib";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/pdf-to-powerpoint";
const PAGE = "/pdf-to-powerpoint/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A wide slide: a dark band with a white heading, black text below, and a photo.
async function deck(name = "pitch.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const photo = await doc.embedJpg(await readFile("tests/fixtures/images/wide.jpg"));
  const slide = doc.addPage([960, 540]);
  slide.drawRectangle({ x: 0, y: 400, width: 960, height: 140, color: rgb(0.1, 0.25, 0.45) });
  slide.drawText("Our plan", { x: 60, y: 450, size: 40, font: bold, color: rgb(1, 1, 1) });
  slide.drawText("Grow to three cities", { x: 60, y: 300, size: 20, font });
  slide.drawText("by the end of the year", { x: 60, y: 276, size: 20, font });
  slide.drawImage(photo, { x: 560, y: 80, width: 300, height: 200 });
  doc.addPage([960, 540]).drawText("Thank you", { x: 400, y: 270, size: 28, font, color: rgb(0.8, 0.1, 0.1) });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// A scan with hidden text over it, the way OCR PDF leaves it.
async function ocrScan(name = "scan.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const photo = await doc.embedJpg(await readFile("tests/fixtures/images/wide.jpg"));
  const page = doc.addPage([400, 300]);
  page.drawImage(photo, { x: 0, y: 0, width: 400, height: 300 });
  page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  page.drawText("Hidden words", { x: 40, y: 200, size: 18, font });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Convert to PowerPoint", exact: true });
const cards = (page: Page) => page.getByTestId("ppt-card");

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


test("pdf to powerpoint - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "PDF to PowerPoint" })).toBeVisible();
  for (const heading of ["How to convert a PDF to PowerPoint", "How converting to PowerPoint works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/pdf-to-powerpoint.png");
});

const slideOf = (files: Record<string, Uint8Array>, number: number) => new TextDecoder().decode(files[`ppt/slides/slide${number}.xml`]);
// Each text box's lines, and the colour of its first letters.
const boxesOf = (slide: string) =>
  [...slide.matchAll(/<p:sp>(.*?)<\/p:sp>/g)].map(([, box]) => ({
    lines: [...box.matchAll(/<a:p>(.*?)<\/a:p>/g)].map(([, p]) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([, t]) => t).join("")),
    colour: /<a:srgbClr val="(\w+)"\/><\/a:solidFill><a:latin/.exec(box)?.[1] ?? "",
    fill: /<\/a:prstGeom><a:solidFill><a:srgbClr val="(\w+)"/.exec(box)?.[1] ?? null,
  }));
// How far apart two "RRGGBB" colours are, from 0 to 765.
const distance = (a: string, b: string) => [0, 2, 4].reduce((sum, at) => sum + Math.abs(parseInt(a.slice(at, at + 2), 16) - parseInt(b.slice(at, at + 2), 16)), 0);

test("pdf to powerpoint - each page becomes a slide, its text in boxes in its own colours", async ({ page }) => {
  await choose(page, [await deck()]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("pitch.pptx");
  const files = unzipSync(bytes);
  expect(Object.keys(files).filter((file) => /^ppt\/slides\/slide\d+\.xml$/.test(file))).toHaveLength(2);
  expect(new TextDecoder().decode(files["ppt/presentation.xml"])).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
  const boxes = boxesOf(slideOf(files, 1));
  expect(boxes.map((box) => box.lines)).toEqual([["Our plan"], ["Grow to three cities", "by the end of the year"]]);
  expect(distance(boxes[0].colour, "FFFFFF")).toBeLessThan(60);
  expect(distance(boxes[1].colour, "000000")).toBeLessThan(60);
  expect(distance(boxesOf(slideOf(files, 2))[0].colour, "CC1A1A")).toBeLessThan(80);
  expect(slideOf(files, 1)).toContain('b="1"');
  // Each slide carries a picture of its page.
  expect(Object.keys(files).filter((file) => file.startsWith("ppt/media/"))).toEqual(["ppt/media/page1.jpeg", "ppt/media/page2.jpeg"]);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("pdf to powerpoint - OCR text goes over its scan in boxes the paper's colour, and several PDFs come in a ZIP", async ({ page }) => {
  await choose(page, [await deck("a.pdf"), await ocrScan("b.pdf")]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_pdf-to-powerpoint.zip");
  const zip = unzipSync(bytes);
  expect(Object.keys(zip).sort()).toEqual(["a.pptx", "b.pptx"]);
  const [box] = boxesOf(slideOf(unzipSync(zip["b.pptx"]), 1));
  expect(box.lines).toEqual(["Hidden words"]);
  expect(box.fill).toMatch(/^[0-9A-F]{6}$/);
});

test("pdf to powerpoint - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`pdf to powerpoint - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await deck("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`pdf to powerpoint - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await deck()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 30000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
