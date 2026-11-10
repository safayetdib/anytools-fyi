import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/fill-pdf-forms";
const PAGE = "/fill-pdf-forms/";

type Upload = { name: string; mimeType: string; buffer: Buffer };

// An application form with every kind of box.
async function application(name = "application.pdf"): Promise<Upload> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  const form = doc.getForm();
  form.createTextField("Full name").addToPage(page, { x: 30, y: 340, width: 200, height: 20 });
  form.createCheckBox("I agree").addToPage(page, { x: 30, y: 300, width: 14, height: 14 });
  const plan = form.createRadioGroup("Plan");
  plan.addOptionToPage("Basic", page, { x: 30, y: 260, width: 14, height: 14 });
  plan.addOptionToPage("Plus", page, { x: 90, y: 260, width: 14, height: 14 });
  const city = form.createDropdown("City");
  city.addOptions(["Dhaka", "Chattogram", "Sylhet"]);
  city.addToPage(page, { x: 30, y: 220, width: 120, height: 20 });
  const id = form.createTextField("Office use");
  id.setText("A-17");
  id.enableReadOnly();
  id.addToPage(page, { x: 30, y: 180, width: 120, height: 20 });
  return { name, mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

const runButton = (page: Page) => page.getByRole("button", { name: "Save filled form", exact: true });
const panel = (page: Page) => page.getByTestId("form-options");
const field = (page: Page, name: string) => page.getByTestId("form-page").first().getByLabel(name, { exact: true });

async function open(page: Page, file?: Upload) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  await page.getByLabel("Select PDF file").setInputFiles(file ?? (await application()));
  await expect(page.getByTestId("form-page").first().locator(".form-page-image")).toBeVisible({ timeout: 15000 });
}

async function saveAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

test("fill pdf forms - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Fill PDF forms" })).toBeVisible();
  for (const heading of ["How to fill in a PDF form", "How filling works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/fill-pdf-forms.png");
});

test("fill pdf forms - every kind of box is filled in on the page and saved, still editable", async ({ page }) => {
  await open(page);
  await expect(panel(page).getByText("This form has 5 boxes to fill in.")).toBeVisible();
  await field(page, "Full name").fill("Nusrat Jahan");
  await field(page, "Full name").press("Enter");
  await field(page, "I agree").check();
  await field(page, "Plan: Plus").check();
  await field(page, "City").selectOption("Sylhet");
  await expect(field(page, "Office use (can't be changed)")).toBeDisabled();
  await expect(panel(page).getByText("4 answers filled in.")).toBeVisible();
  const { name, bytes } = await saveAndDownload(page);
  expect(name).toBe("application_filled.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("its boxes can still be changed");
  const form = (await PDFDocument.load(bytes)).getForm();
  expect(form.getTextField("Full name").getText()).toBe("Nusrat Jahan");
  expect(form.getCheckBox("I agree").isChecked()).toBe(true);
  expect(form.getRadioGroup("Plan").getSelected()).toBe("Plus");
  expect(form.getDropdown("City").getSelected()).toEqual(["Sylhet"]);
  expect(form.getTextField("Office use").getText()).toBe("A-17");
  await page.getByRole("heading", { name: "Preview", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("fill pdf forms - locked-in answers become part of the page, Bangla included", async ({ page }) => {
  await open(page);
  await field(page, "Full name").fill("নুসরাত জাহান");
  await field(page, "City").selectOption("Dhaka");
  await panel(page).getByLabel("Lock the answers in").check();
  const { bytes } = await saveAndDownload(page);
  await expect(page.getByTestId("shell-result-card")).toContainText("with the answers locked in");
  expect((await PDFDocument.load(bytes)).getForm().getFields()).toEqual([]);
});

test("fill pdf forms - Clear answers puts the form back as it came", async ({ page }) => {
  await open(page);
  await field(page, "Full name").fill("Someone");
  await field(page, "I agree").check();
  await panel(page).getByRole("button", { name: "Clear answers" }).click();
  await expect(field(page, "Full name")).toHaveValue("");
  await expect(field(page, "I agree")).not.toBeChecked();
  await expect(panel(page).getByText("Nothing filled in yet.")).toBeVisible();
});

test("fill pdf forms - a PDF without boxes points to Edit PDF", async ({ page }) => {
  await open(page, { name: "letter.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf([300], 400)) });
  await expect(panel(page).getByText("This PDF has no form boxes to fill in.")).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Open Edit PDF" })).toHaveAttribute("href", "/edit-pdf/");
  await expect(runButton(page)).toBeDisabled();
});

for (const width of [320, 375, 768, 1366]) {
  test(`fill pdf forms - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, await application("a-long-file-name-that-should-not-overflow.pdf"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`fill pdf forms - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByLabel("Select PDF file").setInputFiles(await application());
    await expect(page.getByTestId("form-input").first()).toBeVisible({ timeout: 15000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 20000 });
    expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
  });
}
