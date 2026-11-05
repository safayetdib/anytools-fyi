import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/search";
const headerSearch = (page: Page) => page.getByRole("combobox", { name: "Search tools" }).first();
const heroSearch = (page: Page) => page.locator("#hero-search");
const options = (page: Page) => page.locator('#hero-search-list [role="option"]');

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
});

test("search - finds the closest tool and Enter opens it", async ({ page }) => {
  await page.goto("/");
  await heroSearch(page).fill("combine pdf");
  await expect(options(page).first()).toContainText("Merge PDF");
  await heroSearch(page).press("Enter");
  await expect(page).toHaveURL(/\/merge-pdf\/$/);
});

test("search - handles typos and Bangla", async ({ page }) => {
  await page.goto("/");
  await heroSearch(page).fill("pasword");
  await expect(options(page).first()).toContainText("Password generator");
  await heroSearch(page).fill("বিজয়");
  await expect(options(page).first()).toContainText("Bijoy to Unicode");
});

test("search - arrow keys choose a result and Escape closes the list", async ({ page }) => {
  await page.goto("/");
  await heroSearch(page).fill("pdf");
  await expect(options(page)).not.toHaveCount(0);
  await heroSearch(page).press("ArrowDown");
  await heroSearch(page).press("ArrowDown");
  const second = options(page).nth(1);
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(heroSearch(page)).toHaveAttribute("aria-activedescendant", (await second.getAttribute("id")) as string);
  await heroSearch(page).press("Escape");
  await expect(heroSearch(page)).toHaveAttribute("aria-expanded", "false");
  await expect(heroSearch(page)).toHaveValue("pdf");
});

test("search - clicking a result opens it", async ({ page }) => {
  await page.goto("/");
  await heroSearch(page).fill("qr");
  await options(page).first().click();
  await expect(page).toHaveURL(/\/qr-code-generator\/$/);
});

test("search - says when nothing matches and announces counts", async ({ page }) => {
  await page.goto("/");
  await heroSearch(page).fill("xyzzyq");
  await expect(page.locator("#hero-search").locator("xpath=ancestor::form").locator("[data-empty]")).toHaveText(
    "No tools match “xyzzyq”.",
  );
  await heroSearch(page).fill("merge");
  await expect(page.locator("#hero-search").locator("xpath=ancestor::form").locator("[data-status]")).toHaveText(/tool(s)? found/);
});

test("search - the header box works on every page and / focuses it", async ({ page }) => {
  await page.goto("/about/");
  await page.keyboard.press("/");
  await expect(headerSearch(page)).toBeFocused();
  await page.keyboard.type("heic");
  await expect(page.locator('#header-search-list [role="option"]').first()).toContainText("HEIC to JPG");
});

test("search - phones open search from a header button", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/about/");
  await expect(headerSearch(page)).toBeHidden();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(headerSearch(page)).toBeFocused();
  await page.keyboard.type("age");
  await expect(page.locator('#header-search-list [role="option"]').first()).toContainText("Age calculator");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/phone-results.png` });
});

test("search - queries never leave the device", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  requests.length = 0;
  await heroSearch(page).fill("merge pdf");
  await expect(options(page).first()).toBeVisible();
  await heroSearch(page).fill("split");
  await expect(options(page).first()).toContainText("Split PDF");
  expect(requests.filter((path) => path !== "/search-index.json")).toEqual([]);
  expect(requests.filter((path) => path === "/search-index.json").length).toBeLessThanOrEqual(1);
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`search - open results have no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await heroSearch(page).fill("image");
    await expect(options(page).first()).toBeVisible();
    await heroSearch(page).press("ArrowDown");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/results-${colorScheme}.png` });
  });
}
