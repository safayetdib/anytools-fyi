import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { makePdf } from "../fixtures/pdf";

// The test build reads tests/fixtures/ratings.json: Merge PDF has 23 ratings averaging 4.78.
const SCREENSHOT_DIR = "test-results/screenshots/ratings";
const PAGE = "/merge-pdf/";

const pdf = async (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf([100])) });
const rateGroup = (page: Page) => page.getByRole("group", { name: "How was Merge PDF?" });
const star = (page: Page, score: number) => rateGroup(page).getByRole("button", { name: `${score} out of 5`, exact: true });

async function finishMerge(page: Page) {
  await page.getByLabel("Select PDF files").setInputFiles([await pdf("a.pdf"), await pdf("b.pdf")]);
  await page.getByRole("button", { name: "Merge PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible({ timeout: 15000 });
}

// Stands in for the Cloudflare Worker, which the local preview server doesn't run.
async function fakeApi(page: Page, reply: (route: Route) => Promise<void> | void) {
  const bodies: { score: number; voter: string }[] = [];
  await page.route("**/api/ratings/merge-pdf", async (route) => {
    bodies.push(route.request().postDataJSON());
    await reply(route);
  });
  return bodies;
}

const ok = (route: Route) => route.fulfill({ json: { count: 24, average: 4.75 } });

test("ratings - the tool page shows the average and gives it to search engines", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("tool-rating")).toHaveText("4.8 out of 5 · 23 ratings");
  const app = (await page.locator('script[type="application/ld+json"]').allTextContents())
    .map((text) => JSON.parse(text))
    .find((data) => data["@type"] === "WebApplication");
  expect(app.aggregateRating).toEqual({
    "@type": "AggregateRating",
    ratingValue: "4.8",
    ratingCount: 23,
    bestRating: "5",
    worstRating: "1",
  });
});

test("ratings - coming-soon tools neither show nor ask for ratings", async ({ page }) => {
  await page.goto("/split-pdf/");
  await expect(page.getByTestId("tool-rating")).toHaveCount(0);
  await expect(page.getByTestId("shell-rate")).toHaveCount(0);
});

test("ratings - one tap on the result screen sends the rating", async ({ page }) => {
  const bodies = await fakeApi(page, ok);
  await page.goto(PAGE);
  await finishMerge(page);
  await expect(rateGroup(page)).toBeVisible();
  await star(page, 4).click();
  await expect(rateGroup(page)).toContainText("Thanks! You rated it 4 out of 5.");
  await expect(star(page, 4)).toHaveAttribute("aria-pressed", "true");
  await expect(star(page, 5)).toHaveAttribute("aria-pressed", "false");
  expect(bodies).toHaveLength(1);
  expect(bodies[0].score).toBe(4);
  expect(bodies[0].voter).toMatch(/^[0-9a-f-]{36}$/);
});

test("ratings - rating again keeps the same voter and is remembered on the next visit", async ({ page }) => {
  const bodies = await fakeApi(page, ok);
  await page.goto(PAGE);
  await finishMerge(page);
  await star(page, 2).click();
  await expect(rateGroup(page)).toContainText("You rated it 2 out of 5");
  await star(page, 5).click();
  await expect(rateGroup(page)).toContainText("You rated it 5 out of 5");
  expect(bodies.map((body) => body.score)).toEqual([2, 5]);
  expect(bodies[0].voter).toBe(bodies[1].voter);

  await page.reload();
  await finishMerge(page);
  await expect(rateGroup(page)).toContainText("You rated it 5 out of 5");
  await expect(star(page, 5)).toHaveAttribute("aria-pressed", "true");
});

test("ratings - a failed send says so and can be tried again", async ({ page }) => {
  let fail = true;
  await fakeApi(page, (route) => (fail ? route.fulfill({ status: 500, json: {} }) : ok(route)));
  await page.goto(PAGE);
  await finishMerge(page);
  await star(page, 3).click();
  await expect(rateGroup(page)).toContainText("Couldn't send your rating. Please try again.");
  await expect(star(page, 3)).toHaveAttribute("aria-pressed", "false");
  fail = false;
  await star(page, 3).click();
  await expect(rateGroup(page)).toContainText("Thanks! You rated it 3 out of 5.");
});

test("ratings - the daily limit is explained", async ({ page }) => {
  await fakeApi(page, (route) => route.fulfill({ status: 429, json: {} }));
  await page.goto(PAGE);
  await finishMerge(page);
  await star(page, 5).click();
  await expect(rateGroup(page)).toContainText("Too many ratings from your connection today.");
});

for (const width of [320, 375, 768, 1366]) {
  test(`ratings - stars fit and are easy to tap at ${width}px`, async ({ page }) => {
    await fakeApi(page, ok);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await expect(page.getByTestId("tool-rating")).toBeVisible();
    await finishMerge(page);
    await star(page, 5).click();
    await expect(rateGroup(page)).toContainText("Thanks!");
    for (let score = 1; score <= 5; score++) {
      const box = await star(page, score).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByTestId("shell-result-card").screenshot({ path: `${SCREENSHOT_DIR}/result-${width}.png` });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`ratings - no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await fakeApi(page, ok);
    await page.emulateMedia({ colorScheme });
    await page.goto(PAGE);
    const { violations: top } = await new AxeBuilder({ page }).include('[data-testid="tool-rating"]').analyze();
    expect(top.map((v) => v.id)).toEqual([]);
    await finishMerge(page);
    await star(page, 4).click();
    await expect(rateGroup(page)).toContainText("Thanks!");
    const { violations } = await new AxeBuilder({ page }).include('[data-testid="shell-rate"]').analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/page-${colorScheme}.png` });
  });
}
