import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4329" },
  webServer: {
    command: "npx astro build && npx astro preview --host 127.0.0.1 --port 4329 --ignore-lock",
    url: "http://127.0.0.1:4329",
    reuseExistingServer: false,
    env: { SHELL_DEMO: "1" },
  },
});
