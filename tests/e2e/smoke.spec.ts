import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("homepage - loads with no critical accessibility issues", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.filter((v) => v.impact === "critical")).toEqual([]);
});
