import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

const SCREENSHOT_DIR = "test-results/screenshots/jpg-to-pdf";
const PAGE = "/jpg-to-pdf/";
const IMAGES = "tests/fixtures/images";

const picker = (page: Page) => page.getByLabel("Select images");
const panel = (page: Page) => page.getByTestId("images-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Convert to PDF", exact: true });
const cards = (page: Page) => page.getByTestId("image-card");
const choice = (page: Page, name: string) => panel(page).getByRole("radio", { name, exact: true });

async function sizes(bytes: Uint8Array | Buffer) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
}

async function choose(page: Page, names: string[]) {
  await page.goto(PAGE);
  await picker(page).setInputFiles(names.map((name) => `${IMAGES}/${name}`));
  await expect(cards(page)).toHaveCount(names.length);
  await expect(cards(page).locator("img")).toHaveCount(names.length);
}

async function convertAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: /^Your (\d+ files are|file is) ready$/ })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

test("jpg to pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "JPG to PDF" })).toBeVisible();
  for (const heading of ["How to convert JPG to PDF", "How converting works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/jpg-to-pdf/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/jpg-to-pdf.png");
});

test("jpg to pdf - starts like other tools: Portrait, A4, No margin, merged", async ({ page }) => {
  await choose(page, ["tall.jpg", "wide.jpg"]);
  await expect(panel(page).getByRole("heading", { name: "Image to PDF options" })).toBeVisible();
  await expect(choice(page, "Portrait")).toBeChecked();
  await expect(panel(page).getByLabel("Page size")).toHaveValue("a4");
  await expect(choice(page, "No margin")).toBeChecked();
  await expect(panel(page).getByLabel("Merge all images in one PDF file")).toBeChecked();
  await expect(runButton(page)).toBeEnabled();
});

test("jpg to pdf - merged images make one A4 PDF named after the first image", async ({ page }) => {
  await choose(page, ["tall.jpg", "wide.jpg"]);
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("tall.pdf");
  expect(await sizes(bytes)).toEqual([
    [595, 842],
    [595, 842],
  ]);
  await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible();
});

test("jpg to pdf - Fit makes each page the image's size, and turns off orientation", async ({ page }) => {
  await choose(page, ["tall.jpg", "wide.jpg"]);
  await panel(page).getByLabel("Page size").selectOption("fit");
  await expect(choice(page, "Landscape")).toBeDisabled();
  await expect(panel(page)).toContainText("With Fit, each page takes its image's shape.");
  await choice(page, "Big").check();
  const { bytes } = await convertAndDownload(page);
  expect(await sizes(bytes)).toEqual([
    [550, 700],
    [775, 475],
  ]);
});

test("jpg to pdf - landscape Letter with a small margin, and a turned image", async ({ page }) => {
  await choose(page, ["tall.jpg"]);
  await choice(page, "Landscape").check();
  await panel(page).getByLabel("Page size").selectOption("letter");
  await choice(page, "Small").check();
  await page.getByRole("button", { name: "Rotate tall.jpg" }).click();
  await expect(cards(page).first()).toHaveAttribute("data-turn", "90");
  await expect(cards(page).first()).toHaveAttribute("data-shape", "landscape");
  const { bytes } = await convertAndDownload(page);
  expect(await sizes(bytes)).toEqual([[792, 612]]);
});

test("jpg to pdf - separate PDFs come in one ZIP, named after each image", async ({ page }) => {
  await choose(page, ["tall.jpg", "logo.png", "square.webp"]);
  await panel(page).getByLabel("Merge all images in one PDF file").uncheck();
  await panel(page).getByLabel("Page size").selectOption("fit");
  const { name, bytes } = await convertAndDownload(page);
  expect(name).toBe("anytools_images.zip");
  const files = unzipSync(new Uint8Array(bytes));
  expect(Object.keys(files)).toEqual(["tall.pdf", "logo.pdf", "square.pdf"]);
  expect(await sizes(files["square.pdf"])).toEqual([[375, 375]]);
  await expect(page.getByTestId("shell-part")).toHaveCount(3);
});

test("jpg to pdf - a phone photo comes out the way it's shown, not sideways", async ({ page }) => {
  await choose(page, ["phone.jpg"]);
  await panel(page).getByLabel("Page size").selectOption("fit");
  const { bytes } = await convertAndDownload(page);
  // Stored 800×600 with a "turn right" tag, so it shows as 600×800.
  expect(await sizes(bytes)).toEqual([[450, 600]]);
});

for (const width of [320, 375, 768, 1366]) {
  test(`jpg to pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await choose(page, ["tall.jpg", "wide.jpg", "logo.png"]);
    await expect(panel(page).getByRole("heading", { name: "Image to PDF options" })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Portrait", "Landscape", "No margin", "Small", "Big"]) {
      const label = panel(page).locator("label").filter({ hasText: name }).first();
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth), name).toBe(true);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/options-${width}.png`, fullPage: true });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`jpg to pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([`${IMAGES}/tall.jpg`, `${IMAGES}/wide.jpg`]);
    await expect(cards(page).locator("img")).toHaveCount(2);
    await panel(page).getByLabel("Page size").selectOption("fit");
    const { violations: options } = await new AxeBuilder({ page }).analyze();
    expect(options.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}

// --- Pages for other image types: the same tool, each with its own title, guide and search details ---

const FORMATS = [
  { path: "/png-to-pdf/", name: "PNG to PDF", title: "PNG to PDF Converter Online Free, No Upload | AnyTools.fyi", how: "How to convert PNG to PDF", file: "logo.png" },
  { path: "/webp-to-pdf/", name: "WebP to PDF", title: "WebP to PDF Converter Online Free, No Upload | AnyTools.fyi", how: "How to convert WebP to PDF", file: "square.webp" },
  { path: "/image-to-pdf/", name: "Image to PDF", title: "Image to PDF Converter Online Free, No Upload | AnyTools.fyi", how: "How to convert an image to PDF", file: "wide.jpg" },
];

for (const format of FORMATS) {
  test(`jpg to pdf - ${format.name} has its own page that converts`, async ({ page }) => {
    await page.goto(format.path);
    await expect(page).toHaveTitle(format.title);
    await expect(page.getByRole("heading", { level: 1, name: format.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: format.how })).toBeVisible();
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(`https://anytools.fyi${format.path}`);
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
    expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe(`https://anytools.fyi/og${format.path.slice(0, -1)}.png`);
    const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text));
    expect(data.map((item) => item["@type"])).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
    const crumbs = data.find((item) => item["@type"] === "BreadcrumbList").itemListElement.map((item: { name: string }) => item.name);
    expect(crumbs).toEqual(["Home", "PDF tools", "JPG to PDF", format.name]);
    // Links to the other image types, with this one marked as the current page.
    const types = page.getByRole("navigation", { name: "Convert other image types" });
    await expect(types.getByRole("link")).toHaveText(["JPG", "Any image", "PNG", "WebP"]);
    await expect(types.locator('[aria-current="page"]')).toHaveText(format.name === "Image to PDF" ? "Any image" : format.name.split(" ")[0]);
    await picker(page).setInputFiles([`${IMAGES}/${format.file}`]);
    await expect(cards(page).locator("img")).toHaveCount(1);
    const { name } = await convertAndDownload(page);
    expect(name).toBe(format.file.replace(/\.[^.]+$/, ".pdf"));
  });
}

test("jpg to pdf - image type pages are in the sitemap and search, not the tool grid", async ({ page, request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const { path } of FORMATS) expect(xml).toContain(`<loc>https://anytools.fyi${path}</loc>`);
  await page.goto("/");
  await expect(page.getByTestId("tool-card").filter({ hasText: "JPG to PDF" })).toHaveCount(1);
  await expect(page.getByTestId("tool-card").filter({ hasText: "PNG to PDF" })).toHaveCount(0);
});

for (const width of [375, 768]) {
  test(`jpg to pdf - the image type links fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/png-to-pdf/");
    await expect(page.getByRole("navigation", { name: "Convert other image types" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/png-page-${width}.png` });
  });
}
