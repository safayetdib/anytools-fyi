import { expect, test, type Page } from "@playwright/test";

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).first().getAttribute("content");

const jsonLd = (page: Page) =>
  page.locator('script[type="application/ld+json"]').evaluateAll((scripts) => scripts.map((s) => JSON.parse(s.textContent ?? "{}")));

test("seo - Merge PDF has full search and share metadata", async ({ page, request }) => {
  await page.goto("/merge-pdf/");
  await expect(page).toHaveTitle("Merge PDF Files Online Free, No Upload | AnyTools.fyi");
  expect(await meta(page, "description")).toMatch(/^Merge PDF files online for free/);
  expect(await meta(page, "robots")).toMatch(/^index, follow/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://anytools.fyi/merge-pdf/");
  expect(await meta(page, "og:title")).toBe("Merge PDF Files Online Free, No Upload");
  expect(await meta(page, "og:image")).toBe("https://anytools.fyi/og/merge-pdf.png");
  expect(await meta(page, "og:image:width")).toBe("1200");
  expect(await meta(page, "og:image:alt")).toMatch(/Merge PDF/);
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
  expect((await request.get("/og/merge-pdf.png")).headers()["content-type"]).toBe("image/png");

  const types = (await jsonLd(page)).map((data) => data["@type"]);
  expect(types).toEqual(expect.arrayContaining(["WebApplication", "BreadcrumbList", "HowTo", "FAQPage"]));
});

test("seo - coming-soon tools stay out of search", async ({ page }) => {
  await page.goto("/split-pdf/");
  expect(await meta(page, "robots")).toBe("noindex, follow");
  const types = (await jsonLd(page)).map((data) => data["@type"]);
  expect(types).not.toContain("WebApplication");
  expect(types).not.toContain("FAQPage");
});

test("seo - coming-soon tools are labelled on their cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tool-card").filter({ hasText: "Split PDF" })).toContainText("Coming soon");
  await expect(page.getByTestId("tool-card").filter({ hasText: "Merge PDF" })).not.toContainText("Coming soon");
});

test("seo - draft pages and empty categories stay out of search", async ({ page }) => {
  for (const path of ["/terms/", "/image-tools/", "/no-such-page/"]) {
    await page.goto(path);
    expect(await meta(page, "robots"), path).toBe("noindex, follow");
  }
});

test("seo - the sitemap lists only indexable pages", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("<loc>https://anytools.fyi/merge-pdf/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/pdf-tools/</loc>");
  expect(xml).not.toContain("split-pdf");
  expect(xml).not.toContain("image-tools");
  expect(xml).not.toContain("/terms/");
});

test("seo - robots.txt and llms.txt are served for crawlers", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: https://anytools.fyi/sitemap.xml");
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toMatch(/^# AnyTools\.fyi/);
  expect(llms).toContain("[Merge PDF](https://anytools.fyi/merge-pdf/)");
  expect(llms).not.toContain("Split PDF");
  const full = await (await request.get("/llms-full.txt")).text();
  expect(full).toContain("Does this upload my files?");
});

test("seo - icons and the manifest are complete", async ({ request }) => {
  for (const path of ["/favicon.ico", "/favicon.svg", "/apple-touch-icon.png", "/icon-maskable-512.png", "/og/site.png"]) {
    expect((await request.get(path)).ok(), path).toBe(true);
  }
  const manifest = await (await request.get("/site.webmanifest")).json();
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);
});
