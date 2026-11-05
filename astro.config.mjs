import { defineConfig } from "astro/config";

const shellDemo = Boolean(process.env.SHELL_DEMO);

export default defineConfig({
  site: "https://anytools.fyi",
  trailingSlash: "always",
  // Browser tests build with the demo tools into their own folder, so they can't reach a deploy.
  outDir: shellDemo ? "./dist-e2e" : "./dist",
  integrations: [
    {
      name: "shell-demo",
      hooks: {
        "astro:config:setup": ({ injectRoute }) => {
          if (shellDemo) injectRoute({ pattern: "/dev/[demo]", entrypoint: "./src/dev/ShellDemo.astro" });
        },
      },
    },
  ],
});
