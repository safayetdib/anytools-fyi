import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/navigation";
const menuButton = (page: Page) => page.locator("header summary");
const panel = (page: Page) => page.locator("header .panel");

// --- Tools menu ---

test("navbar - desktop shows quick links and an All tools menu", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Merge PDF" })).toBeVisible();
  await expect(menuButton(page)).toHaveText(/All tools/);
  await menuButton(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator(".tool-link")).toHaveCount(30);
  await expect(panel(page).getByRole("link", { name: "PDF tools" })).toHaveAttribute("href", "/pdf-tools/");
  await expect(panel(page).getByRole("link", { name: "See all tools" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/menu-1366.png` });
});

test("navbar - phones open the menu from the Menu tab instead of quick links", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Merge PDF" })).toBeHidden();
  await expect(menuButton(page)).toBeHidden();
  await page.getByRole("navigation", { name: "Quick links" }).getByRole("button", { name: "Menu" }).click();
  await expect(panel(page).getByRole("link", { name: "Add watermark" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/menu-375.png` });
});

test("navbar - menu opens by keyboard and Escape closes it back to the button", async ({ page }) => {
  await page.goto("/");
  await menuButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(menuButton(page)).toBeFocused();
});

test("navbar - clicking outside closes the menu", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1400 });
  await page.goto("/");
  await menuButton(page).click();
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(20, 1350);
  await expect(panel(page)).toBeHidden();
});

test("navbar - menu works with JavaScript turned off", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4329/");
  await menuButton(page).click();
  await expect(panel(page).locator(".tool-link")).toHaveCount(30);
  await context.close();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`navbar - open menu has no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await menuButton(page).click();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
}

// --- Tool pages and sub routes ---

test("404 - unknown pages return 404 with a way back", async ({ page }) => {
  const response = await page.goto("/no-such-page/");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See all tools" }).last()).toHaveAttribute("href", "/tools/");
});

// --- Every route ---

test("routes - every internal link leads to a working page", async ({ request }) => {
  const seen = new Set<string>(["/"]);
  const queue = ["/"];
  while (queue.length) {
    const path = queue.shift() as string;
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    const html = await response.text();
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      if (href.startsWith("/_astro/") || /\.(svg|json)$/.test(href)) continue;
      if (!seen.has(href)) {
        seen.add(href);
        queue.push(href);
      }
    }
  }
  // Home, 18 PDF tools, the PDF hub, All tools and the 8 info pages.
  expect(seen.size).toBeGreaterThanOrEqual(1 + 18 + 1 + 1 + 8);
});

const ROUTES = ["/", "/pdf-tools/", "/tools/", "/merge-pdf/", "/split-pdf/", "/about/", "/no-such-page/"];
const WIDTHS = [320, 375, 414, 768, 1024, 1366, 1920, 2560];

for (const path of ROUTES) {
  test(`responsive - ${path} has no sideways scroll at any width`, async ({ page }) => {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

for (const path of ["/about/", "/privacy/", "/no-such-page/", "/word-counter/"]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`${path} - no axe violations in ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    });
  }
}

// --- Theme ---

test("theme - the switch changes the theme and remembers it", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Dark theme" }).first();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Dark theme" }).first()).toHaveAttribute("aria-pressed", "true");
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});

test("theme - phones find the switch at the top right", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const toggle = page.getByRole("banner").getByRole("button", { name: "Dark theme" });
  const box = await toggle.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeGreaterThan(375 - 40);
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
});

test("search - placeholders are in English only", async ({ page }) => {
  await page.goto("/");
  for (const placeholder of await page.locator("input[placeholder]").evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).placeholder))) {
    expect(placeholder).not.toMatch(/[ঀ-৿]/);
  }
});
