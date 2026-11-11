import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const shellDemo = Boolean(process.env.SHELL_DEMO);

// OCR PDF's languages, served from this site at a fixed address: the reader asks for them by name, so they can't carry
// a hash like other built files. The folder is the models' version, so a new version gets a new address.
const OCR_LANGUAGES = ["eng", "ben"];
const OCR_PATH = "/ocr/4.0.0_best_int/";
const ocrSource = (file) => fileURLToPath(new URL(`./node_modules/@tesseract.js-data/${file.split(".")[0]}/4.0.0_best_int/${file}`, import.meta.url));

export default defineConfig({
  site: "https://anytools.fyi",
  trailingSlash: "always",
  // Browser tests build with the demo tools into their own folder, so they can't reach a deploy.
  outDir: shellDemo ? "./dist-e2e" : "./dist",
  integrations: [
    {
      name: "ocr-languages",
      hooks: {
        "astro:server:setup": ({ server }) => {
          server.middlewares.use(async (request, response, next) => {
            const file = request.url?.startsWith(OCR_PATH) ? request.url.slice(OCR_PATH.length) : "";
            if (!OCR_LANGUAGES.some((code) => file === `${code}.traineddata.gz`)) return next();
            const bytes = await readFile(ocrSource(file));
            response.setHeader("Content-Type", "application/gzip");
            response.setHeader("Content-Length", bytes.length);
            response.end(bytes);
          });
        },
        "astro:build:done": async ({ dir }) => {
          const target = new URL(`.${OCR_PATH}`, dir);
          await mkdir(target, { recursive: true });
          for (const code of OCR_LANGUAGES) await copyFile(ocrSource(`${code}.traineddata.gz`), new URL(`${code}.traineddata.gz`, target));
        },
      },
    },
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
