import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makePdf, pageWidths } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/mobile";
const PAGE = "/merge-pdf/";

const pdf = async (name: string, widths: number[]) => ({
  name,
  mimeType: "application/pdf",
  buffer: Buffer.from(await makePdf(widths)),
});
const picker = (page: Page) => page.getByLabel("Select PDF files");
const tabs = (page: Page) => page.getByRole("navigation", { name: "Quick links" });

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true });

async function chooseThree(page: Page) {
  await page.goto(PAGE);
  await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200]), await pdf("c.pdf", [300])]);
  await expect(page.getByTestId("shell-file")).toHaveCount(3);
}

async function mergeThree(page: Page) {
  await chooseThree(page);
  await page.getByRole("button", { name: "Merge PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
}

const isDockedAtBottom = async (page: Page, testId: string) => {
  const box = await page.getByTestId(testId).boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  return Math.abs((box?.y ?? 0) + (box?.height ?? 0) - height) <= 1;
};

// --- App shell ---

test("mobile - a tab bar sits at the bottom of every page", async ({ page }) => {
  await page.goto("/tools/");
  await expect(tabs(page)).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Tools" })).toHaveAttribute("aria-current", "page");
  const box = await tabs(page).boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(812, 0);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/tabs.png` });
});

test("mobile - the Search tab opens search", async ({ page }) => {
  await page.goto("/");
  await tabs(page).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("banner").getByRole("combobox")).toBeFocused();
});

test("mobile - the Dark theme tab switches the theme", async ({ page }) => {
  await page.goto("/");
  await tabs(page).getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("mobile - wider screens have no tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  await expect(tabs(page)).toBeHidden();
});

// --- Tool page ---

test("mobile - the guide folds, and each section opens on tap", async ({ page }) => {
  await page.goto(PAGE);
  const limits = page.getByRole("button", { name: "Limits" });
  await expect(limits).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Other file types can't be merged.")).toBeHidden();
  await limits.click();
  await expect(limits).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Other file types can't be merged.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Limits" })).toBeVisible();
});

test("mobile - the guide stays open on wider screens", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(PAGE);
  await expect(page.getByRole("button", { name: "Limits" })).toHaveCount(0);
  await expect(page.getByText("Other file types can't be merged.")).toBeVisible();
});

// --- Arranging files ---

test("mobile - choosing files shows step 2, hides the tab bar and docks Merge", async ({ page }) => {
  await chooseThree(page);
  await expect(page.getByTestId("shell-steps")).toHaveText("Step 2 of 3: Arrange");
  await expect(tabs(page)).toBeHidden();
  expect(await isDockedAtBottom(page, "shell-action-bar")).toBe(true);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/files.png` });
});

test("mobile - file rows are one slim line with a More button", async ({ page }) => {
  await chooseThree(page);
  const row = await page.getByTestId("shell-file").first().boundingBox();
  expect(row?.height ?? 0).toBeLessThan(72);
  await expect(page.getByRole("button", { name: "Move b.pdf up" })).toBeHidden();
  await expect(page.getByRole("button", { name: "More for b.pdf" })).toBeVisible();
});

test("mobile - the More sheet moves and removes a file", async ({ page }) => {
  await chooseThree(page);
  await page.getByRole("button", { name: "More for a.pdf" }).click();
  const sheet = page.getByRole("dialog", { name: "a.pdf" });
  await expect(sheet.getByRole("button", { name: "Move up" })).toBeHidden();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/sheet.png` });
  await sheet.getByRole("button", { name: "Move down" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("shell-file").locator(".shell-file-name")).toHaveText(["b.pdf", "a.pdf", "c.pdf"]);
  await expect(page.getByRole("button", { name: "More for a.pdf" })).toBeFocused();

  await page.getByRole("button", { name: "More for c.pdf" }).click();
  await page.getByRole("dialog", { name: "c.pdf" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("shell-file")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "More for a.pdf" })).toBeFocused();
});

test("mobile - Cancel closes the sheet without changes", async ({ page }) => {
  await chooseThree(page);
  await page.getByRole("button", { name: "More for b.pdf" }).click();
  await page.getByRole("dialog", { name: "b.pdf" }).getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("shell-file")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "More for b.pdf" })).toBeFocused();
});

// --- Result ---

test("mobile - the result docks Download and shows step 3", async ({ page }) => {
  await mergeThree(page);
  await expect(page.getByTestId("shell-steps")).toHaveText("Step 3 of 3: Download");
  expect(await isDockedAtBottom(page, "shell-result-bar")).toBe(true);
  await expect(page.getByRole("link", { name: /^Download merged\.pdf/ })).toBeInViewport();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/result.png` });
});

test("mobile - selected pages get their tools docked at the bottom", async ({ page }) => {
  await mergeThree(page);
  await page.getByRole("checkbox", { name: "Select page 2" }).check();
  expect(await isDockedAtBottom(page, "page-toolbar")).toBe(true);
  await expect(page.getByTestId("shell-result-bar")).toBeHidden();
  for (const name of ["Rotate", "Move to…", "Remove", "Clear"]) {
    await expect(page.getByTestId("page-toolbar").getByRole("button", { name }).or(page.getByText(name, { exact: true })).first()).toBeInViewport();
  }
  await page.screenshot({ path: `${SCREENSHOT_DIR}/selected.png` });
  await page.getByRole("button", { name: "Clear" }).click();
  expect(await isDockedAtBottom(page, "shell-result-bar")).toBe(true);
});

// --- Page view ---

async function swipe(page: Page, dx: number) {
  await page.getByTestId("viewer-tools").waitFor();
  await page.locator('[data-el="viewer-scroll"]').evaluate((el, distance) => {
    const box = el.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x = box.left + box.width / 2;
    const init = { pointerType: "touch", pointerId: 7, bubbles: true, isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: x, clientY: y }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, clientX: x + distance, clientY: y + 4 }));
  }, dx);
}

test("mobile - the page view fills the screen and swipes between pages", async ({ page }) => {
  await mergeThree(page);
  await page.getByRole("button", { name: "Open page 1 larger" }).click();
  const viewer = page.getByRole("dialog");
  const box = await viewer.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 375 });
  await expect(viewer.getByText("Page 1 of 3")).toBeVisible();
  await swipe(page, -120);
  await expect(viewer.getByText("Page 2 of 3")).toBeVisible();
  await swipe(page, 120);
  await expect(viewer.getByText("Page 1 of 3")).toBeVisible();
  // A short drag isn't a swipe.
  await swipe(page, -20);
  await expect(viewer.getByText("Page 1 of 3")).toBeVisible();
  await page.screenshot({ path: `${SCREENSHOT_DIR}/viewer.png` });
});

test("mobile - page view tools sit in one row, and Move opens the position box", async ({ page }) => {
  await mergeThree(page);
  await page.getByRole("button", { name: "Open page 1 larger" }).click();
  const tools = page.getByTestId("viewer-tools");
  const tops = await tools.getByRole("button").evaluateAll((buttons) =>
    buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  await expect(tools.getByLabel("Move to position")).toBeHidden();
  await tools.getByRole("button", { name: "Move", exact: true }).click();
  await expect(tools.getByLabel("Move to position")).toBeFocused();
  await tools.getByLabel("Move to position").fill("3");
  await tools.getByLabel("Move to position").press("Enter");
  await expect(page.getByRole("dialog").getByText("Page 3 of 3")).toBeVisible();
  await expect(tools.getByLabel("Move to position")).toBeHidden();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Apply changes" }).click();
  const link = page.getByRole("link", { name: /^Download merged\.pdf/ });
  const download = page.waitForEvent("download");
  await link.click();
  const bytes = await (await download).path().then((p) => import("node:fs/promises").then((fs) => fs.readFile(p)));
  expect(await pageWidths(bytes)).toEqual([200, 300, 100]);
});

// --- Checks across the journey ---

for (const colorScheme of ["light", "dark"] as const) {
  test(`mobile - each step has no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const check = async () => expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);
    await check();
    await picker(page).setInputFiles([await pdf("a.pdf", [100]), await pdf("b.pdf", [200])]);
    await check();
    await page.getByRole("button", { name: "More for a.pdf" }).click();
    await check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Merge PDF", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
    await page.getByRole("checkbox", { name: "Select page 1" }).check();
    await check();
  });
}

for (const width of [320, 360, 375, 414]) {
  test(`mobile - the merge journey never scrolls sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await mergeThree(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("checkbox", { name: "Select page 1" }).check();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
}
