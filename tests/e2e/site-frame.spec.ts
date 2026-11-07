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

test("site frame - the home page is indexable and allows pinch zoom", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index, follow/);
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
  const links = page.locator("header a:visible, header summary:visible, header button:visible, footer a");
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

// --- Logo ---

test("site frame - logo links home from the header and footer", async ({ page }) => {
  await page.goto("/merge-pdf/");
  await expect(page.getByRole("banner").getByRole("link", { name: "AnyTools.fyi home" })).toBeVisible();
  await page.getByRole("contentinfo").getByRole("link", { name: "AnyTools.fyi home" }).click();
  await expect(page).toHaveURL("/");
});

test("site frame - logo types itself in once per visit", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/logo-intro/);
  await page.goto("/tools/");
  await expect(page.locator("html")).not.toHaveClass(/logo-intro/);
});

test("site frame - logo stays still with reduced motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/logo-intro/);
  await expect(page.locator(".header .logo-glyph").first()).toHaveCSS("opacity", "1");
  await context.close();
});

test("site frame - logo and theme switch share one row on a small phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const logo = await page.locator(".header .logo").boundingBox();
  const menu = await page.getByRole("banner").getByRole("button", { name: "Dark theme" }).boundingBox();
  expect(Math.abs((logo?.y ?? 0) + (logo?.height ?? 0) / 2 - ((menu?.y ?? 0) + (menu?.height ?? 0) / 2))).toBeLessThan(4);
});

test("site frame - icons and manifest are served", async ({ page, request }) => {
  await page.goto("/");
  const links = page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]');
  expect(await links.count()).toBe(5);
  for (const href of await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""))) {
    expect((await request.get(href)).ok(), href).toBe(true);
  }
  const manifest = await (await request.get("/site.webmanifest")).json();
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
});

test("site frame - the header stays at the top while scrolling", async ({ page }) => {
  for (const width of [375, 1366]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/merge-pdf/");
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    expect((await page.getByRole("banner").boundingBox())?.y).toBe(0);
    await expect(page.getByRole("banner").getByRole("link", { name: "AnyTools.fyi home" })).toBeInViewport();
  }
});
