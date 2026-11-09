import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { unzlibSync } from "fflate";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, degrees } from "pdf-lib";

const SCREENSHOT_DIR = "test-results/screenshots/sign-pdf";
const PAGE = "/sign-pdf/";

const picker = (page: Page) => page.getByLabel("Select PDF file");
const panel = (page: Page) => page.getByTestId("sign-options");
const runButton = (page: Page) => page.getByRole("button", { name: "Sign PDF", exact: true });
const placed = (page: Page) => page.getByTestId("sign-placed");
const placements = async (page: Page) => JSON.parse((await panel(page).locator("[data-placements-value]").inputValue()) || "[]") as { page: number; x: number; y: number; width: number }[];

// An agreement with a signature line on each page. `turned` pages are turned a quarter by the PDF itself.
async function agreement(pages = 2, turned: number[] = []) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= pages; number++) {
    const sheet = doc.addPage([595, 842]);
    sheet.drawText(`Agreement page ${number}`, { x: 50, y: 780, size: 18, font });
    sheet.drawText("Signature: ______________", { x: 50, y: 120, size: 12, font });
    if (turned.includes(number)) sheet.setRotation(degrees(90));
  }
  return { name: "agreement.pdf", mimeType: "application/pdf", buffer: Buffer.from(await doc.save()) };
}

// A phone photo of a signature: grey paper with a shadow in one corner, and a blue pen stroke.
async function signaturePhoto(page: Page, { blank = false } = {}) {
  const base64 = await page.evaluate(async (blank) => {
    const canvas = new OffscreenCanvas(1200, 700);
    const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    const paper = context.createRadialGradient(100, 650, 10, 100, 650, 700);
    paper.addColorStop(0, "#8d8f8a");
    paper.addColorStop(1, "#cfd1cb");
    context.fillStyle = paper;
    context.fillRect(0, 0, 1200, 700);
    if (!blank) {
      context.strokeStyle = "#2b3a8c";
      context.lineWidth = 7;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(200, 450);
      context.bezierCurveTo(300, 100, 380, 120, 400, 400);
      context.bezierCurveTo(430, 520, 520, 150, 600, 380);
      context.bezierCurveTo(650, 500, 750, 250, 1000, 300);
      context.stroke();
    }
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  }, blank);
  return { name: "signature.jpg", mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}

async function start(page: Page, file = agreement()) {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await file]);
  await expect(page.getByTestId("sign-page")).toHaveCount((await PDFDocument.load((await file).buffer)).getPageCount());
  await panel(page).getByLabel("Upload signature").setInputFiles(await signaturePhoto(page));
  await expect(panel(page).getByRole("img", { name: "Your signature, as it will look" })).toBeVisible();
}

// The colour of the most solid pixel in the preview, and the preview's width divided by its height.
async function previewInk(page: Page) {
  return panel(page)
    .locator("[data-preview-image]")
    .evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(img, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let best = 0;
      for (let at = 3; at < data.length; at += 4) if (data[at] > data[best + 3]) best = at - 3;
      let clear = 0;
      for (let at = 3; at < data.length; at += 4) if (data[at] === 0) clear++;
      return { rgb: [data[best], data[best + 1], data[best + 2]], ratio: canvas.width / canvas.height, clearShare: clear / (data.length / 4) };
    });
}

async function signAndDownload(page: Page) {
  await runButton(page).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
  const pending = page.waitForEvent("download");
  await page.getByTestId("shell-result-card").getByRole("link", { name: /^Download / }).click();
  const download = await pending;
  return { name: download.suggestedFilename(), bytes: new Uint8Array(await readFile(await download.path())) };
}

// Where each page draws the signature. pdf-lib draws a picture in four steps before "Do": move, turn, size, skew.
async function drawnImages(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((sheet) => {
    const contents = sheet.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const text = streams
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => {
        const raw = stream.getContents();
        return new TextDecoder().decode(stream.dict.get(PDFName.of("Filter")) ? unzlibSync(raw) : raw);
      })
      .join("\n");
    return Array.from(text.matchAll(/q\s+([\s\S]*?)\/\S+ Do\s+Q/g)).map((match) => {
      const steps = Array.from(match[1].matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g)).map((step) => step.slice(1).map(Number));
      return { move: steps[0].slice(4), turn: steps[1].slice(0, 2), size: [steps[2][0], steps[2][3]] };
    });
  });
}

test("sign pdf - page shows the working tool and its help text", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Sign PDF" })).toBeVisible();
  for (const heading of ["How to sign a PDF", "How cleaning a signature works", "Questions"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const types = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text)["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]));
  expect(await page.title()).toBe("Sign PDF Online Free: Add Your Signature | AnyTools.fyi");
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("index, follow");
  expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe("https://anytools.fyi/sign-pdf/");
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe("https://anytools.fyi/og/sign-pdf.png");
  await page.locator("[data-sig-diagram]").getByRole("button", { name: "Show it uncleaned" }).click();
  await expect(page.locator("[data-sig-diagram] figcaption")).toContainText("Without cleaning");
});

test("sign pdf - the photo is cleaned: paper see-through, pen colour kept, cropped to the ink", async ({ page }) => {
  await start(page);
  await expect(panel(page).getByRole("heading", { name: "Signing options" })).toBeVisible();
  await expect(panel(page).getByRole("radio", { name: "Clean" })).toBeChecked();
  await expect(panel(page).getByRole("radio", { name: "Pen colour" })).toBeChecked();
  const ink = await previewInk(page);
  // The pen is dark blue: blue is its strongest part.
  expect(ink.rgb[2]).toBeGreaterThan(ink.rgb[0] + 40);
  expect(ink.clearShare).toBeGreaterThan(0.6);
  // The stroke spans about 800 × 350 of the 1200 × 700 photo, so the crop is wider than the photo's own shape.
  expect(ink.ratio).toBeGreaterThan(2);
  await expect(runButton(page)).toBeDisabled();
});

test("sign pdf - filters, colour and rotation change the signature", async ({ page }) => {
  await start(page);
  await panel(page).getByRole("radio", { name: "Red" }).check();
  await expect.poll(async () => (await previewInk(page)).rgb).toEqual([0xc4, 0x2b, 0x2b]);
  // Any colour, from the rainbow swatch's colour picker.
  await panel(page).getByLabel("Any colour").fill("#ff8800");
  await expect.poll(async () => (await previewInk(page)).rgb).toEqual([0xff, 0x88, 0x00]);
  await expect(panel(page).getByRole("radio", { name: "Red" })).not.toBeChecked();
  const flat = (await previewInk(page)).ratio;
  await panel(page).getByRole("button", { name: "Rotate the signature a quarter turn clockwise" }).click();
  await expect.poll(async () => (await previewInk(page)).ratio).toBeCloseTo(1 / flat, 1);
  await panel(page).getByRole("radio", { name: "Original" }).check();
  await expect(panel(page).getByText(/Original keeps the photo as it is/)).toBeVisible();
  await expect(panel(page).getByLabel("Contrast")).toBeHidden();
  // The whole photo, paper and all, turned: 700 × 1200.
  await expect.poll(async () => (await previewInk(page)).clearShare).toBe(0);
  await expect.poll(async () => (await previewInk(page)).ratio).toBeCloseTo(700 / 1200, 2);
  await panel(page).getByRole("button", { name: "Reset" }).click();
  await expect(panel(page).getByRole("radio", { name: "Clean" })).toBeChecked();
  await expect.poll(async () => (await previewInk(page)).ratio).toBeCloseTo(flat, 1);
  await panel(page).getByRole("radio", { name: "Bold" }).check();
  await expect(panel(page).getByLabel("Thickness")).toHaveValue("1");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/controls.png` });
});

test("sign pdf - place, drag, resize, move with keys and remove", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await start(page);
  await panel(page).getByRole("button", { name: "Add to page 1" }).click();
  await expect(placed(page)).toHaveCount(1);
  await expect(panel(page).getByText("1 signature placed.")).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
  const [first] = await placements(page);
  expect(first.page).toBe(1);
  expect(first.width).toBeCloseTo(0.3, 2);

  // Adding scrolls smoothly to the signature; wait until it stops before dragging.
  await expect(placed(page)).toBeInViewport();
  await expect.poll(async () => {
    const before = await page.evaluate(() => scrollY);
    await page.waitForTimeout(150);
    return (await page.evaluate(() => scrollY)) === before;
  }).toBe(true);
  // Drag it up and to the left, onto the signature line.
  const box = (await placed(page).boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y - 50, { steps: 5 });
  await page.mouse.up();
  const [moved] = await placements(page);
  expect(moved.x).toBeLessThan(first.x - 0.2);
  expect(moved.y).toBeLessThan(first.y - 0.03);

  // Drag the corner to make it smaller.
  const handle = (await placed(page).locator(".sign-handle").boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x - 60, handle.y, { steps: 5 });
  await page.mouse.up();
  const [smaller] = await placements(page);
  expect(smaller.width).toBeLessThan(moved.width - 0.05);

  await placed(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("+");
  const [keyed] = await placements(page);
  expect(keyed.x).toBeCloseTo(smaller.x + 0.01, 3);
  expect(keyed.y).toBeCloseTo(smaller.y + 0.05, 3);
  expect(keyed.width).toBeCloseTo(smaller.width + 0.02, 3);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/placed.png` });

  await page.keyboard.press("Delete");
  await expect(placed(page)).toHaveCount(0);
  await expect(runButton(page)).toBeDisabled();
  await placements(page).then((list) => expect(list).toEqual([]));
});

test("sign pdf - the signed file draws the signature exactly where it was placed", async ({ page }) => {
  await start(page);
  await panel(page).getByRole("button", { name: "Add to page 1" }).click();
  const [spot] = await placements(page);
  const ratio = (await previewInk(page)).ratio;
  const { name, bytes } = await signAndDownload(page);
  expect(name).toBe("agreement_signed.pdf");
  await expect(page.getByTestId("shell-result-card")).toContainText("agreement.pdf is signed on 1 page");
  const drawn = await drawnImages(bytes);
  expect(drawn.map((list) => list.length)).toEqual([1, 0]);
  const [image] = drawn[0];
  const width = spot.width * 595;
  expect(image.size[0]).toBeCloseTo(width, 0);
  // The full-size signature has the preview's shape, give or take rounding.
  expect(Math.abs(image.size[1] - width / ratio)).toBeLessThan(2);
  expect(image.move[0]).toBeCloseTo(spot.x * 595, 0);
  expect(Math.abs(image.move[1] - (842 - spot.y * 842 - image.size[1]))).toBeLessThan(1);
});

test("sign pdf - every page, including a page the PDF turns sideways", async ({ page }) => {
  await start(page, agreement(3, [2]));
  await panel(page).getByRole("button", { name: "Add to every page" }).click();
  await expect(placed(page)).toHaveCount(3);
  await expect(panel(page).getByText("3 signatures placed.")).toBeVisible();
  const spots = await placements(page);
  expect(spots.map((spot) => spot.page)).toEqual([1, 2, 3]);
  const { bytes } = await signAndDownload(page);
  await expect(page.getByTestId("shell-result-card")).toContainText("signed on 3 pages");
  const drawn = await drawnImages(bytes);
  expect(drawn.map((list) => list.length)).toEqual([1, 1, 1]);
  // Page 2 is shown 842 wide and 595 tall; the picture is turned with it so it reads upright.
  const [turned] = drawn[1];
  expect(turned.turn.map((value) => Math.round(value))).toEqual([0, 1]);
  expect(turned.size[0]).toBeCloseTo(spots[1].width * 842, 0);
});

test("sign pdf - a picture with no signature in it is explained", async ({ page }) => {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await agreement()]);
  await panel(page).getByLabel("Upload signature").setInputFiles(await signaturePhoto(page, { blank: true }));
  await expect(page.getByTestId("sign-error")).toContainText("No signature could be found");
  await expect(panel(page).getByRole("button", { name: /^Add to page/ })).toBeHidden();
});

for (const width of [320, 375, 768, 1366]) {
  test(`sign pdf - fits without sideways scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await start(page);
    await panel(page).getByRole("button", { name: "Add to page 1" }).click();
    await expect(placed(page)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const name of ["Original", "Clean", "Bold"]) {
      const label = panel(page).locator("label").filter({ hasText: name }).first();
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), name).toBe(true);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/placed-${width}.png` });
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`sign pdf - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: empty } = await new AxeBuilder({ page }).analyze();
    expect(empty.map((v) => v.id)).toEqual([]);
    await picker(page).setInputFiles([await agreement()]);
    await expect(page.locator(".sign-page-image").first()).toBeVisible();
    await panel(page).getByLabel("Upload signature").setInputFiles(await signaturePhoto(page));
    await panel(page).getByRole("button", { name: "Add to page 1" }).click();
    await expect(placed(page)).toHaveCount(1);
    const { violations: placing } = await new AxeBuilder({ page }).analyze();
    expect(placing.map((v) => v.id)).toEqual([]);
    await runButton(page).click();
    await expect(page.getByRole("heading", { name: "Preview", exact: true })).toBeVisible({ timeout: 15000 });
    const { violations: result } = await new AxeBuilder({ page }).analyze();
    expect(result.map((v) => v.id)).toEqual([]);
  });
}
