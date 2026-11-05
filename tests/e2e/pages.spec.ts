import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/pages";
const PAGES = [
  { name: "home", path: "/", schema: "WebSite" },
  { name: "pdf-hub", path: "/pdf-tools/", schema: "CollectionPage" },
  { name: "all-tools", path: "/tools/", schema: "CollectionPage" },
  { name: "tool", path: "/merge-pdf/", schema: "WebApplication" },
  { name: "text-tool", path: "/word-counter/", schema: "WebApplication" },
  { name: "variant", path: "/compress-image-to-20kb/", schema: "WebApplication" },
];

async function jsonLdTypes(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((text) => [JSON.parse(text)]).map((data) => data["@type"]);
}

// --- Homepage ---

test("homepage - lists live tools with the most used first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Everyday tools that stay on your device" })).toBeVisible();
  const cards = page.getByTestId("tool-card");
  await expect(cards).toHaveCount(19);
  await expect(cards.first()).toHaveAttribute("href", "/merge-pdf/");
  await expect(cards.first()).toContainText("Merge PDF");
});

test("homepage - category pills are real links", async ({ page }) => {
  await page.goto("/");
  const pills = page.getByRole("navigation", { name: "Categories" });
  await expect(pills.getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
  await pills.getByRole("link", { name: "PDF" }).click();
  await expect(page).toHaveURL(/\/pdf-tools\/$/);
});

test("homepage - works with JavaScript turned off and ships no scripts", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4329/");
  await expect(page.getByTestId("tool-card")).toHaveCount(19);
  await expect(page.locator("script[src]:not([type='module'])")).toHaveCount(0);
  await context.close();
});

test("homepage - hero illustration is decorative and under 4 KB", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const art = page.getByTestId("hero-art");
  await expect(art).toHaveAttribute("aria-hidden", "true");
  expect((await art.evaluate((el) => el.outerHTML)).length).toBeLessThan(4096);
  await expect(art).toBeVisible();
});

// --- Hub and all tools ---

test("pdf hub - lists its tools with a breadcrumb", async ({ page }) => {
  await page.goto("/pdf-tools/");
  await expect(page.getByRole("heading", { level: 1, name: "PDF tools" })).toBeVisible();
  await expect(page.getByTestId("tool-card")).toHaveCount(4);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "PDF" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("hubs below three tools are not published", async ({ page }) => {
  for (const path of ["/text-tools/", "/calculators/"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("all tools - groups every tool by category", async ({ page }) => {
  await page.goto("/tools/");
  await expect(page.getByTestId("tool-card")).toHaveCount(19);
  for (const name of ["PDF tools", "Image tools", "Bangla tools", "Developer tools", "Text tools", "Calculators"]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
});

// --- Every page ---

for (const { name, path, schema } of PAGES) {
  test(`${name} - metadata and structured data are valid`, async ({ page }) => {
    await page.goto(path);
    expect((await page.title()).length).toBeLessThanOrEqual(60);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description?.length ?? 0).toBeGreaterThan(0);
    expect(description?.length ?? 999).toBeLessThanOrEqual(155);
    await expect(page.locator("h1")).toHaveCount(1);
    expect(await jsonLdTypes(page)).toContain(schema);
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`${name} - no axe violations in ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${colorScheme}.png`, fullPage: true });
    });
  }

  for (const width of [320, 375, 414, 768, 1024, 1366, 1920, 2560]) {
    test(`${name} - no sideways scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}-${width}.png`, fullPage: true });
    });
  }
}
