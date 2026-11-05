import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Download, type Page } from "@playwright/test";

const SCREENSHOT_DIR = "test-results/screenshots/tool-shell";
const FILE_PAGE = "/dev/shell-demo/";
const TEXT_PAGE = "/dev/shell-demo-text/";

const txt = (name: string, content = "hello") => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(content),
});

const filePicker = (page: Page) => page.getByLabel("Select text files");
const live = (page: Page) => page.getByTestId("shell-live");
const files = (page: Page) => page.getByTestId("shell-file");

async function downloadText(download: Download) {
  return readFile(await download.path(), "utf8");
}

async function runAndDownload(page: Page) {
  await page.getByRole("button", { name: "Join files" }).click();
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("link", { name: /^Download joined\.txt/ }).click();
  return pending;
}

// --- Selecting ---

test("tool shell - file input is reachable by keyboard and shows focus", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).focus();
  await expect(filePicker(page)).toBeFocused();
  const outline = await page.getByTestId("shell-pick").evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: parseFloat(style.outlineWidth), kind: style.outlineStyle };
  });
  expect(outline.width).toBeGreaterThanOrEqual(2);
  expect(outline.kind).not.toBe("none");
});

test("tool shell - selecting files lists names and sizes and moves focus", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt"), txt("b.txt")]);
  await expect(files(page)).toHaveCount(2);
  await expect(files(page).first()).toContainText("a.txt");
  await expect(files(page).first()).toContainText("5 B");
  await expect(page.getByRole("heading", { name: "Arrange your files" })).toBeFocused();
  await expect(live(page)).toContainText("2 files added");
});

test("tool shell - dropping files works, and shows a drag state", async ({ page }) => {
  await page.goto(FILE_PAGE);
  const zone = page.getByTestId("shell-zone");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["hello"], "dropped.txt", { type: "text/plain" }));
    (window as unknown as { transfer: DataTransfer }).transfer = transfer;
  });
  await zone.dispatchEvent("dragover", { dataTransfer: await page.evaluateHandle(() => (window as unknown as { transfer: DataTransfer }).transfer) });
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(() => (window as unknown as { transfer: DataTransfer }).transfer) });
  await expect(files(page)).toContainText("dropped.txt");
});

test("tool shell - wrong type and oversized files get a clear text error", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([{ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("x") }]);
  await expect(page.getByTestId("shell-error")).toContainText("photo.png");
  await expect(page.getByTestId("shell-error")).toContainText("TXT files");
  await filePicker(page).setInputFiles([txt("huge.txt", "x".repeat(2000))]);
  await expect(page.getByTestId("shell-error")).toContainText("huge.txt");
});

test("tool shell - large files show a warning before processing", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("big.txt", "x".repeat(600))]);
  await expect(page.getByTestId("shell-warning")).toBeVisible();
});

test("tool shell - file names are shown as text, never as markup", async ({ page }) => {
  await page.goto(FILE_PAGE);
  const name = '<img src=x onerror="window.hacked=true">.txt';
  await filePicker(page).setInputFiles([txt(name)]);
  await expect(files(page).first()).toContainText("<img");
  await expect(files(page).locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { hacked?: boolean }).hacked)).toBeUndefined();
});

// --- Arranging ---

test("tool shell - reorder with buttons keeps focus and changes the output", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt", "AAA"), txt("b.txt", "BBB")]);
  await page.getByRole("button", { name: "Move b.txt up" }).click();
  await expect(files(page).first()).toContainText("b.txt");
  await expect(page.getByRole("button", { name: "Move b.txt down" })).toBeFocused();
  await expect(live(page)).toContainText("b.txt moved to position 1");
  const download = await runAndDownload(page);
  expect(await downloadText(download)).toBe("BBB\nAAA");
});

test("tool shell - removing moves focus sensibly and the last goes back to select", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt"), txt("b.txt")]);
  await page.getByRole("button", { name: "Remove a.txt" }).click();
  await expect(files(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Remove b.txt" })).toBeFocused();
  await page.getByRole("button", { name: "Remove b.txt" }).click();
  await expect(filePicker(page)).toBeFocused();
});

test("tool shell - can add more files from the working screen", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt")]);
  await page.getByLabel("Add more files").setInputFiles([txt("b.txt")]);
  await expect(files(page)).toHaveCount(2);
});

// --- Full flow ---

test("tool shell - completes the whole flow with only the keyboard", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt", "AAA"), txt("b.txt", "BBB")]);
  await page.getByRole("button", { name: "Join files" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeFocused();
  await expect(live(page)).toContainText("Done. 2 files joined");
  const pending = page.waitForEvent("download");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: /^Download joined\.txt/ })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await downloadText(await pending)).toBe("AAA\nBBB");
  await page.getByRole("button", { name: "Start over" }).focus();
  await page.keyboard.press("Enter");
  await expect(filePicker(page)).toBeFocused();
  await expect(files(page)).toHaveCount(0);
});

test("tool shell - download control names the file and its size", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt", "AAA")]);
  await page.getByRole("button", { name: "Join files" }).click();
  await expect(page.getByRole("link", { name: "Download joined.txt (3 B)" })).toBeVisible();
});

test("tool shell - running shows labelled progress", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt")]);
  await page.getByRole("button", { name: "Join files" }).click();
  await expect(page.getByRole("progressbar", { name: "Progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
});

test("tool shell - cancelling keeps the files and the page usable", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt", "AAA")]);
  await page.getByRole("button", { name: "Join files" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(files(page)).toHaveCount(1);
  await expect(live(page)).toContainText("Cancelled");
  await expect(page.getByRole("button", { name: "Join files" })).toBeFocused();
  await page.waitForTimeout(1200);
  await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeHidden();
  const download = await runAndDownload(page);
  expect(await downloadText(download)).toBe("AAA");
});

test("tool shell - a tool error is explained and the page recovers", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("fail.txt"), txt("ok.txt", "OK")]);
  await page.getByRole("button", { name: "Join files" }).click();
  await expect(page.getByTestId("shell-error")).toContainText("fail.txt");
  await expect(page.getByRole("button", { name: "Join files" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Join files" })).toHaveAttribute(
    "aria-describedby",
    /shell-error/,
  );
  await page.getByRole("button", { name: "Remove fail.txt" }).click();
  await expect(page.getByTestId("shell-error")).toBeHidden();
  const download = await runAndDownload(page);
  expect(await downloadText(download)).toBe("OK");
});

test("tool shell - tool options reach the tool", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await filePicker(page).setInputFiles([txt("a.txt", "AAA"), txt("b.txt", "BBB")]);
  await page.getByLabel("Separator").fill("--");
  const download = await runAndDownload(page);
  expect(await downloadText(download)).toBe("AAA--BBB");
});

test("tool shell - processing makes no network requests", async ({ page }) => {
  await page.goto(FILE_PAGE);
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("blob:")) requests.push(request.url());
  });
  await filePicker(page).setInputFiles([txt("a.txt")]);
  await runAndDownload(page);
  expect(requests).toEqual([]);
});

// --- Text tools ---

test("text tool - empty input gets a linked error and typing is never cleared", async ({ page }) => {
  await page.goto(TEXT_PAGE);
  const input = page.getByLabel("Text to change");
  await page.getByRole("button", { name: "Make uppercase" }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", /shell-error/);
  await expect(input).toBeFocused();
  await input.fill("hello");
  await expect(page.getByTestId("shell-error")).toBeHidden();
  await page.getByRole("button", { name: "Make uppercase" }).click();
  await expect(page.getByTestId("shell-output")).toHaveText("HELLO");
  await page.getByRole("button", { name: "Edit input" }).click();
  await expect(input).toHaveValue("hello");
  await expect(input).toBeFocused();
});

test("text tool - output can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(TEXT_PAGE);
  await page.getByLabel("Text to change").fill("hello");
  await page.getByRole("button", { name: "Make uppercase" }).click();
  await page.getByRole("button", { name: "Copy" }).click();
  await expect(live(page)).toContainText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("HELLO");
});

// --- Every screen ---

const screens: { name: string; reach: (page: Page) => Promise<void> }[] = [
  { name: "select", reach: async (page) => void (await page.goto(FILE_PAGE)) },
  {
    name: "working",
    reach: async (page) => {
      await page.goto(FILE_PAGE);
      const long = `${"a-very-long-file-name-without-any-spaces-".repeat(4)}.txt`;
      await filePicker(page).setInputFiles([txt("a.txt", "x".repeat(600)), txt(long)]);
    },
  },
  {
    name: "error",
    reach: async (page) => {
      await page.goto(FILE_PAGE);
      await filePicker(page).setInputFiles([txt("fail.txt")]);
      await page.getByRole("button", { name: "Join files" }).click();
      await expect(page.getByTestId("shell-error")).toBeVisible();
    },
  },
  {
    name: "running",
    reach: async (page) => {
      await page.goto(FILE_PAGE);
      await filePicker(page).setInputFiles([txt("a.txt")]);
      await page.getByRole("button", { name: "Join files" }).click();
      await expect(page.getByRole("progressbar")).toBeVisible();
    },
  },
  {
    name: "result",
    reach: async (page) => {
      await page.goto(FILE_PAGE);
      await filePicker(page).setInputFiles([txt("a.txt")]);
      await page.getByRole("button", { name: "Join files" }).click();
      await expect(page.getByRole("heading", { name: "Your file is ready" })).toBeVisible();
    },
  },
  {
    name: "text",
    reach: async (page) => {
      await page.goto(TEXT_PAGE);
      await page.getByLabel("Text to change").fill("hello");
      await page.getByRole("button", { name: "Make uppercase" }).click();
      await expect(page.getByTestId("shell-output")).toBeVisible();
    },
  },
];

for (const screen of screens) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`tool shell ${screen.name} - no axe violations in ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await screen.reach(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/${screen.name}-${colorScheme}.png`, fullPage: true });
    });
  }

  test(`tool shell ${screen.name} - fits a 320px phone with large targets`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await screen.reach(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const controls = page.locator("[data-tool-shell] button:visible, [data-tool-shell] a:visible");
    for (let i = 0; i < (await controls.count()); i++) {
      const box = await controls.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/${screen.name}-320.png`, fullPage: true });
  });
}
