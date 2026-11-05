import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://anytools.fyi",
  trailingSlash: "always",
  // Browser tests build with the demo tools into their own folder, so they can't reach a deploy.
  outDir: process.env.SHELL_DEMO ? "./dist-e2e" : "./dist",
});
