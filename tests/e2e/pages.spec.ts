import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/pages";
const PAGES = [
  { name: "home", path: "/", schema: "WebSite" },
  { name: "pdf-hub", path: "/pdf-tools/", schema: "CollectionPage" },
  { name: "all-tools", path: "/tools/", schema: "CollectionPage" },
  { name: "tool", path: "/merge-pdf/", schema: "WebApplication" },
  // Coming-soon tools carry only their breadcrumb until they work.
  { name: "coming-soon", path: "/split-pdf/", schema: "BreadcrumbList" },
];

async function jsonLdTypes(page: Page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((text) => [JSON.parse(text)]).map((data) => data["@type"]);
}

// --- Homepage ---

test("homepage - lists the PDF tools with the most used first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Free PDF tools that get the job done in seconds" })).toBeVisible();
  const cards = page.getByTestId("tool-card");
  await expect(cards).toHaveCount(16);
  await expect(cards.first()).toHaveAttribute("href", "/merge-pdf/");
  await expect(cards.first()).toContainText("Merge PDF");
});

// Pills return once a second category is live; with PDF only there's nothing to filter.
test("homepage - shows no category pills while there's one category", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Categories" })).toHaveCount(0);
});

test("homepage - only PDF tools are offered", async ({ page }) => {
  await page.goto("/");
  for (const name of await page.getByTestId("tool-card").locator(".name").allTextContents()) {
    expect(name, name).toMatch(/PDF|JPG|page numbers|watermark/i);
  }
});

test("homepage - works with JavaScript turned off and ships no scripts", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4329/");
  await expect(page.getByTestId("tool-card")).toHaveCount(16);
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
  await expect(page.getByTestId("tool-card")).toHaveCount(16);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
});

test("removed categories and tools are not published", async ({ page }) => {
  for (const path of ["/image-tools/", "/bangla-tools/", "/text-tools/", "/calculators/", "/compress-image/", "/word-counter/"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

test("all tools - groups every tool by category", async ({ page }) => {
  await page.goto("/tools/");
  await expect(page.getByTestId("tool-card")).toHaveCount(16);
  await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: "PDF tools" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Image tools" })).toHaveCount(0);
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

// --- Privacy promise ---

test("privacy - browser-only tools show the promise near the top", async ({ page }) => {
  await page.goto("/merge-pdf/");
  const badge = page.getByRole("complementary", { name: "Your files never leave your device" });
  await expect(badge).toBeVisible();
  await expect(badge.getByRole("link", { name: "How we protect your privacy" })).toHaveAttribute("href", "/how-we-protect-your-privacy/");
  const badgeTop = (await badge.boundingBox())?.y ?? 0;
  const toolTop = (await page.getByTestId("shell-zone").boundingBox())?.y ?? 0;
  expect(badgeTop).toBeLessThan(toolTop);
});

for (const path of ["/", "/tools/", "/pdf-tools/", "/about/"]) {
  test(`privacy - ${path} makes no upload promise`, async ({ page }) => {
    await page.goto(path);
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const claim of ["not uploaded", "nothing is uploaded", "stay on your device", "stays on your device", "in your browser"]) {
      expect(text, claim).not.toContain(claim);
    }
  });
}

// --- Tables ---

for (const width of [320, 375, 1280]) {
  test(`tables - have a header row, borders and stay inside the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/cookies/");
    const table = page.locator(".prose table").first();
    await expect(table.locator("th").first()).toHaveText("Name");
    expect(await table.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
    const headerBg = await table.locator("th").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const cellBg = await table.locator("tbody td").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(headerBg).not.toBe(cellBg);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    // Names are never split across lines.
    const code = table.locator("td code").last();
    const box = await code.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(30);
  });
}

test("pages - contact gives an email address and the maker's website", async ({ page }) => {
  await page.goto("/contact/");
  await expect(page.getByRole("link", { name: "safayetdib@gmail.com" })).toHaveAttribute("href", "mailto:safayetdib@gmail.com");
  await expect(page.getByRole("link", { name: "safayetadib.com" })).toHaveAttribute("href", "https://safayetadib.com/");
});

test("pages - about says who makes the site", async ({ page }) => {
  await page.goto("/about/");
  await expect(page.getByRole("heading", { name: "Who makes it" })).toBeVisible();
  await expect(page.getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", "https://www.linkedin.com/in/safayetdib/");
});
