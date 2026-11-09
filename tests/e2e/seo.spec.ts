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
  expect(xml).toContain("<loc>https://anytools.fyi/split-pdf/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/rotate-pdf/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/add-watermark/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/compress-pdf/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/sign-pdf/</loc>");
  expect(xml).not.toContain("image-tools");
  expect(xml).not.toContain("/terms/");
  expect(xml).toContain("<loc>https://anytools.fyi/cookies/</loc>");
  expect(xml).toContain("<loc>https://anytools.fyi/privacy/</loc>");
});

test("seo - the cookies, privacy and contact pages are published", async ({ page }) => {
  for (const path of ["/cookies/", "/privacy/", "/contact/"]) {
    await page.goto(path);
    expect(await meta(page, "robots"), path).toContain("index, follow");
    await expect(page.getByText(/^Draft:/), path).toHaveCount(0);
  }
});

test("seo - robots.txt and llms.txt are served for crawlers", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap: https://anytools.fyi/sitemap.xml");
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toMatch(/^# AnyTools\.fyi/);
  expect(llms).toContain("[Merge PDF](https://anytools.fyi/merge-pdf/)");
  expect(llms).toContain("[Split PDF](https://anytools.fyi/split-pdf/)");
  expect(llms).toContain("[Rotate PDF](https://anytools.fyi/rotate-pdf/)");
  expect(llms).toContain("[Add watermark](https://anytools.fyi/add-watermark/)");
  expect(llms).toContain("[Compress PDF](https://anytools.fyi/compress-pdf/)");
  expect(llms).toContain("[Sign PDF](https://anytools.fyi/sign-pdf/)");
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

test("seo - the homepage names the founder for search engines", async ({ page }) => {
  await page.goto("/");
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  const org = blocks.map((text) => JSON.parse(text)).find((data) => data["@type"] === "Organization");
  expect(org.founder).toMatchObject({
    "@type": "Person",
    name: "Safayet Adib",
    sameAs: ["https://safayetadib.com/", "https://www.linkedin.com/in/safayetdib/"],
  });
  expect(await page.locator('meta[property="og:site_name"]').getAttribute("content")).toBe("AnyTools");
  await expect(page.locator('link[rel="icon"][sizes="192x192"]')).toHaveAttribute("href", "/icon-192.png");
});
