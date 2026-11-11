import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument, PDFName, PDFString, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { makeEncryptedPdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/flatten-pdf";
const PAGE = "/flatten-pdf/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// A filled-in form with a name and a ticked box, and a blue square comment.
async function form(name = "form.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fields = doc.getForm();
  const field = fields.createTextField("name");
  field.addToPage(page, { x: 50, y: 300, width: 200, height: 24, font });
  field.setText("Rahim Uddin");
  const agree = fields.createCheckBox("agree");
  agree.addToPage(page, { x: 50, y: 250, width: 16, height: 16 });
  agree.check();
  fields.updateFieldAppearances(font);
  const look = doc.context.register(doc.context.stream("0 0 1 rg 0 0 50 50 re f", { Type: "XObject", Subtype: "Form", BBox: [0, 0, 50, 50] }));
  page.node.Annots()?.push(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Square", Rect: [100, 100, 150, 150], Contents: PDFString.of("Looks good"), AP: { N: look } })));
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

async function plain(name = "plain.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Flatten PDF", exact: true });
const cards = (page: Page) => page.getByTestId("flatten-card");

async function choose(page: Page, files: Upload[]) {
  await page.goto(PAGE);
  await page.getByLabel("Select PDF files").setInputFiles(files);
  await expect(cards(page)).toHaveCount(files.length);
}

async function flattenAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// The first page's text, what's still on top of it, and how many blue pixels it shows.
async function inspect(bytes: Uint8Array) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS }).promise;
  const data = canvas.getContext("2d").getImageData(0, 0, viewport.width, viewport.height).data;
  let blue = 0;
  for (let at = 0; at < data.length; at += 4) if (data[at + 2] > 200 && data[at] < 60 && data[at + 1] < 60) blue++;
  const text = (await page.getTextContent()).items.map((item) => ("str" in item ? item.str : "")).join("");
  const annotations = (await page.getAnnotations()).map((annotation) => annotation.subtype).sort();
  return { text, annotations, blue };
}

test("flatten pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Flatten PDF" })).toBeVisible();
  for (const heading of ["How to flatten a PDF", "How flattening works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/flatten-pdf.png");
});

test("flatten pdf - answers and comments become part of the page", async ({ page }) => {
  const input = await form();
  const before = await inspect(new Uint8Array(input.buffer));
  expect(before.annotations).toEqual(["Square", "Widget", "Widget"]);
  await choose(page, [input]);
  const { name, bytes } = await flattenAndDownload(page);
  expect(name).toBe("form_flattened.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("2 form fields and 1 comment in form.pdf are now part of its pages");
  const after = await inspect(bytes);
  expect(after.annotations).toEqual([]);
  expect(after.text).toContain("Rahim Uddin");
  // The square comment is still drawn, now as part of the page.
  expect(after.blue).toBeGreaterThan(2000);
  expect((await PDFDocument.load(bytes)).catalog.has(PDFName.of("AcroForm"))).toBe(false);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("flatten pdf - only comments can be flattened, keeping the form to fill in", async ({ page }) => {
  await choose(page, [await form()]);
  await page.getByLabel(/Form fields/).uncheck();
  const { bytes } = await flattenAndDownload(page);
  const after = await inspect(bytes);
  expect(after.annotations).toEqual(["Widget", "Widget"]);
  expect((await PDFDocument.load(bytes)).getForm().getTextField("name").getText()).toBe("Rahim Uddin");
});

test("flatten pdf - with nothing chosen, it asks for a choice", async ({ page }) => {
  await choose(page, [await form()]);
  await page.getByLabel(/Form fields/).uncheck();
  await page.getByLabel(/Comments and markup/).uncheck();
  await expect(runButton(page)).toBeDisabled();
  await expect(page.getByTestId("flatten-options").getByRole("status")).toHaveText("Choose at least one thing to flatten.");
});

test("flatten pdf - several PDFs come in a ZIP, leaving out ones with nothing to flatten", async ({ page }) => {
  await choose(page, [await form("a.pdf"), await form("b.pdf"), await plain("c.pdf")]);
  const { name, bytes } = await flattenAndDownload(page);
  expect(name).toBe("anytools_flatten-pdf.zip");
  expect(Object.keys(unzipSync(bytes)).sort()).toEqual(["a_flattened.pdf", "b_flattened.pdf"]);
  await expect(page.getByTestId("shell-result-card")).toContainText("1 had nothing to flatten");
});

test("flatten pdf - a PDF with nothing to flatten says so", async ({ page }) => {
  await choose(page, [await plain()]);
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("plain.pdf has no form fields or comments to flatten");
});

test("flatten pdf - a file with a password says what to do", async ({ page }) => {
  await choose(page, [{ name: "locked.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makeEncryptedPdf()) }]);
  await expect(cards(page)).toContainText("Needs its password");
  await runButton(page).click();
  await expect(page.getByTestId("shell-error").first()).toContainText("locked.pdf needs its password. Unlock it first with Unlock PDF");
});

for (const width of [320, 375, 768, 1366]) {
  test(`flatten pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, [await form("a-long-file-name-that-should-not-overflow.pdf")]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`flatten pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF files").setInputFiles([await form()]);
    await expect(cards(page)).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
