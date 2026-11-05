# AnyTools.fyi

Free everyday tools that run entirely in the browser: PDF, image, Bangla, developer and text tools. Files are processed on the visitor's device and are never uploaded.

The site is static HTML built with [Astro](https://astro.build). Each tool is a small TypeScript module, and heavy work runs in a Web Worker with libraries that load only when needed.

> **Status:** private preview. Every page is marked `noindex` until all 20 launch tools are built. See [Launch](#launch).

## Contents

- [Requirements](#requirements)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Testing](#testing)
- [Project structure](#project-structure)
- [How a tool works](#how-a-tool-works)
- [Adding a tool](#adding-a-tool)
- [Project rules](#project-rules)
- [Launch](#launch)
- [Troubleshooting](#troubleshooting)

## Requirements

| Tool | Version |
| --- | --- |
| Node.js | 22.23.4 or newer (tested on 26) |
| npm | 9.6.5 or newer |
| Git | Any recent version |

Check your versions:

```bash
node -v
```

```bash
npm -v
```

## Getting started

1. Clone the repository:

   ```bash
   git clone https://github.com/safayetdib/anytools-fyi.git
   ```

   ```bash
   cd anytools-fyi
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open http://localhost:4321 in your browser.

The dev server reloads pages as you edit. Restart it after adding or renaming files in `src/content/` or changing `src/content.config.ts`, because content collections are set up when the server starts.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server at http://localhost:4321 |
| `npm run build` | Type-checks the project, then builds the static site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder, to check a production build |
| `npm run lint` | Runs ESLint, including the rule that bans network calls in tool code |
| `npm test` | Runs the unit tests with Vitest |
| `npm run test:e2e` | Builds the site and runs the browser tests with Playwright |

## Testing

Run all four checks before every commit. Each one must pass.

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run test:e2e
```

### Unit tests

Unit tests live next to the code they test (`*.test.ts` in `src/`) and in `tests/unit/`. They cover the tool registry, search accuracy, the tool shell's logic, colour contrast of the design tokens and each tool's processing code.

### Browser tests

Browser tests live in `tests/e2e/`. They check every page in light and dark themes with [axe](https://github.com/dequelabs/axe-core) for accessibility, at widths from 320 px to 2560 px, and run each tool end to end with real files.

The first time, install the Chromium browser Playwright uses:

```bash
npx playwright install chromium
```

`npm run test:e2e` builds the site with test-only demo pages into `dist-e2e/`, so they can never reach a real deploy, then serves it on port 4329.

Screenshots from the browser tests are saved in `test-results/screenshots/`. They're useful for checking layouts without opening a browser.

## Project structure

```
src/
  pages/            Routes. [tool].astro and [hub].astro build every tool and hub page
  components/       Header, footer, tool cards, search box and the tool shell
  layouts/          Page layouts for regular and info pages
  tools/<slug>/     One folder per tool: Tool.astro, tool.ts, worker and tests
  content/tools/    Help text for each built tool: limits, steps, explainer and FAQ
  lib/
    tools.ts        Tool registry: the single list of tools, hubs and routes
    shell/          Tool shell: shared flow for selecting, running and downloading
    worker/         Helpers for running tool code in a Web Worker
    pdf/            Shared PDF page previews (pdf.js)
    search/         In-browser tool search
  i18n/en.json      All interface text
  styles/           Design tokens and global styles
  dev/              Demo pages used only by the browser tests
tests/
  e2e/              Playwright browser tests
  unit/             Project-wide unit tests
  fixtures/         Test file generators, such as PDFs
.planning/          Design tokens and tool briefs
```

The [build blueprint](Free%20Browser%20Tools%20Platform%20Build%20Blueprint.md) holds the product plan, performance budget, accessibility standards and route map.

## How a tool works

Every tool page uses the same **tool shell** (`src/components/ToolShell.astro` and `src/lib/shell/`). It handles choosing files, ordering them, progress, cancelling, errors, the result, downloads and screen reader announcements. A tool only supplies its settings and a `run` function:

```ts
export const tool: ToolDefinition = {
  config: { mode: "files", accept: ".pdf", acceptLabel: "PDF files", multiple: true, minFiles: 2, maxFileSize: 100 * MB },
  async run({ files }, options, { signal, onProgress }) {
    // Do the work, then return the result.
    return { files: [{ name: "merged.pdf", blob }], summary: "Done." };
  },
};
```

Heavy work runs in a Web Worker through `createWorkerRunner` (`src/lib/worker/client.ts`), so the page stays responsive and Cancel stops the job at once. Large libraries are imported inside the worker, so they download only after the visitor starts choosing files.

Optional hooks add more: `warm()` starts loading the worker early, `previewFile()` shows a thumbnail for each chosen file, and `previewOutput()` shows the result's pages before download.

`src/tools/merge-pdf/` is the reference tool to copy from.

## Adding a tool

1. **Write a brief** in `.planning/tools/<slug>.md`: target searches, who needs it, what competitors lack, library, limits and FAQ questions.
2. **Write failing tests first:** unit tests for the processing code, and a browser test in `tests/e2e/<slug>.spec.ts`.
3. **Build the tool** in `src/tools/<slug>/`:
   - `tool.ts`: the `ToolDefinition`.
   - `Tool.astro`: renders `ToolShell` and mounts the tool.
   - `worker.ts` and the processing code, if the work is heavy.
4. **Add the help text** in `src/content/tools/<slug>.md`, using `merge-pdf.md` as the model:
   - `limits`, `steps` and optional `tips`, each with an icon name from `src/lib/help-icons.ts`. They render as icon cards, a numbered stepper and tip cards.
   - A short explainer as the Markdown body.
   - 4 to 6 FAQ answers, shown as expandable questions. Always answer "Does this upload my files?" and "Does it work offline?".
   - Optionally, an interactive `Diagram.astro` in the tool's folder. It appears under the explainer automatically.
5. **Add interface text** to `src/i18n/en.json`.
6. **Mark it built:** set `built: true` for the tool in `src/lib/tools.ts`. A unit test checks that every built tool has a `Tool.astro` and help text, and that no unbuilt tool does.
7. **Credit any new library** and its license in `src/pages/credits.md`.
8. **Run all four checks**, and test the tool on a real phone.

The tool's page, card, menu entry, search result, breadcrumb and structured data all come from the registry, so no routing changes are needed.

## Project rules

- **No network calls in tool code.** ESLint fails the build if code in `src/tools/` uses `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon`. Libraries are bundled with the site, never loaded from another domain.
- **Accessibility:** every page must meet WCAG 2.2 AA. Use native controls, visible labels and text error messages, and make sure every control works by keyboard and is at least 44 px tall on phones.
- **Performance:** pages ship as static HTML. Keep each page's first load under the budget in the blueprint, and load heavy libraries only on demand.
- **Design tokens:** use the CSS variables in `src/styles/tokens.css`, never raw colours. A unit test checks the contrast of every token pair in both themes.
- **Text:** all interface text lives in `src/i18n/en.json`, so a Bangla version can be added later.
- **Commits:** one task per commit, with all checks passing, in the form `type(scope): what`, where type is `feat`, `fix`, `test`, `refactor`, `chore` or `docs`.

## Launch

The site isn't public yet. Before launch:

1. Build all 20 tools in the registry.
2. Finish and review the draft pages: Contact, Privacy policy, Terms and Cookies.
3. Set `INDEXABLE` to `true` in `src/lib/site.ts`. A unit test blocks this while any tool is unbuilt.
4. Work through the launch checklist in the [build blueprint](Free%20Browser%20Tools%20Platform%20Build%20Blueprint.md).

`npm run build` outputs a static site in `dist/` that any static host can serve. The hosting choice hasn't been made yet.

## Troubleshooting

**Help text, limits or FAQ are missing on a tool page in dev.** Restart `npm run dev`. Content collections are only set up when the server starts.

**Port 4321 is already in use.** Another dev server is still running. Stop it, or start this one on another port:

```bash
npm run dev -- --port 4322
```

**Browser tests fail with "Executable doesn't exist".** Install the browser:

```bash
npx playwright install chromium
```

**`npm install` shows audit warnings.** The current moderate warnings come from ESLint's tooling, which isn't shipped to visitors. Don't run `npm audit fix --force`, because it can install breaking versions.
