import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4329";

export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL,
    // Tests start with the cookie choice already made, so the banner doesn't cover the page.
    // The consent tests clear this to see the banner as a first-time visitor would.
    storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: "anytools-consent", value: "denied" }] }] },
  },
  webServer: {
    command: "npx astro build && npx astro preview --host 127.0.0.1 --port 4329 --ignore-lock",
    url: baseURL,
    reuseExistingServer: false,
    env: { SHELL_DEMO: "1" },
  },
});
