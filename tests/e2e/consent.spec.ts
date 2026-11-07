import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makePdf } from "../fixtures/pdf";

const SCREENSHOT_DIR = "test-results/screenshots/consent";

// A first-time visitor: no choice saved yet.
test.use({ storageState: { cookies: [], origins: [] } });

const banner = (page: Page) => page.getByRole("region", { name: "Help us improve AnyTools" });
const saved = (page: Page) => page.evaluate(() => localStorage.getItem("anytools-consent"));

test("consent - first visit asks once, with equal Accept and Decline", async ({ page }) => {
  await page.goto("/");
  await expect(banner(page)).toBeVisible();
  const accept = await banner(page).getByRole("button", { name: "Accept" }).boundingBox();
  const decline = await banner(page).getByRole("button", { name: "Decline" }).boundingBox();
  expect(accept?.width).toBeCloseTo(decline?.width ?? 0, 0);
  expect(accept?.height).toBe(decline?.height);
  await expect(banner(page).getByRole("link", { name: "About cookies" })).toHaveAttribute("href", "/cookies/");
  await page.screenshot({ path: `${SCREENSHOT_DIR}/banner.png` });
});

test("consent - Decline is remembered and nothing is sent to Google", async ({ page }) => {
  const google: string[] = [];
  page.on("request", (request) => {
    if (/google-analytics|googletagmanager/.test(request.url())) google.push(request.url());
  });
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Decline" }).click();
  await expect(banner(page)).toBeHidden();
  expect(await saved(page)).toBe("denied");
  await page.goto("/tools/");
  await expect(banner(page)).toBeHidden();
  expect(google).toEqual([]);
});

test("consent - Accept is remembered, and analytics stays off away from the live site", async ({ page }) => {
  const google: string[] = [];
  page.on("request", (request) => {
    if (/google-analytics|googletagmanager/.test(request.url())) google.push(request.url());
  });
  await page.goto("/");
  await banner(page).getByRole("button", { name: "Accept" }).click();
  await expect(banner(page)).toBeHidden();
  expect(await saved(page)).toBe("granted");
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(google).toEqual([]);
});

test("consent - Cookie settings in the footer reopens the choice", async ({ page }) => {
  await page.goto("/about/");
  await banner(page).getByRole("button", { name: "Accept" }).click();
  await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole("button", { name: "Decline" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await saved(page)).toBe("denied");
});

test("consent - on phones the banner sits above the tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const tabs = await page.getByRole("navigation", { name: "Quick links" }).boundingBox();
  // The banner slides in, so its place is read once it has settled.
  await expect
    .poll(async () => {
      const card = await banner(page).boundingBox();
      return (card?.y ?? 0) + (card?.height ?? 0) <= (tabs?.y ?? 0);
    })
    .toBe(true);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/phone.png` });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`consent - the banner has no axe violations in ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  });
}

test("consent - a finished merge is announced without any file details", async ({ page }) => {
  await page.goto("/merge-pdf/");
  await banner(page).getByRole("button", { name: "Decline" }).click();
  await page.evaluate(() => {
    (window as unknown as { done: unknown[] }).done = [];
    document.addEventListener("anytools:tool-done", (event) =>
      (window as unknown as { done: unknown[] }).done.push((event as CustomEvent).detail ?? null),
    );
  });
  const pdf = async (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from(await makePdf([100])) });
  await page.getByLabel("Select PDF files").setInputFiles([await pdf("secret-a.pdf"), await pdf("secret-b.pdf")]);
  await page.getByRole("button", { name: "Merge PDF", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { done: unknown[] }).done)).toEqual([null]);
});

test("consent - the card springs in and drops away when answered", async ({ page }) => {
  await page.goto("/");
  const card = banner(page);
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("consent-in");
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toHaveAttribute("data-leaving", "");
  await expect(card).toBeHidden();
});

test("consent - with reduced motion the card appears and goes without animation", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce", storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4329/");
  const card = banner(page);
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(card).toBeHidden();
  // It went straight away, with no exit animation in between.
  expect(await page.locator("[data-consent]").getAttribute("data-leaving")).toBeNull();
  await context.close();
});
