import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/site-frame";

// --- Structure ---

test("site frame - has landmarks, one h1 and a contact link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Contact" })).toBeVisible();
});

test("site frame - metadata stays private and allows pinch zoom", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://anytools.fyi/");
  await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
});

// --- Keyboard ---

test("site frame - skip link is first and moves focus to main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("site frame - focused links show a visible 2px outline", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { width: parseFloat(style.outlineWidth), kind: style.outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.kind).not.toBe("none");
});

// --- Responsive ---

for (const width of [320, 360, 640, 900, 1440]) {
  test(`site frame - no sideways scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/width-${width}.png`, fullPage: true });
  });
}

test("site frame - nav and footer links are at least 44px tall on phones", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const links = page.locator("header a, footer a");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await links.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

// --- Accessibility ---

for (const colorScheme of ["light", "dark"] as const) {
  test(`site frame - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/theme-${colorScheme}.png`, fullPage: true });
  });
}
