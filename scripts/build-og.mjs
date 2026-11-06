// Builds the 1200x630 share images shown when a page is posted on social apps and chat.
// One for the site, and one for each working tool. Run with: node scripts/build-og.mjs
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { TOOLS } from "../src/lib/tools.ts";
import { iconFor } from "../src/lib/icons.ts";

const en = JSON.parse(await readFile("src/i18n/en.json", "utf8"));
const logo = JSON.parse(await readFile("src/components/logo-data.json", "utf8"));
// Fonts are embedded, because a page set from a string can't load local files.
const font = async (weight) =>
  `data:font/woff2;base64,${(
    await readFile(`node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-${weight}-normal.woff2`)
  ).toString("base64")}`;
const FONTS = { 500: await font(500), 800: await font(800) };

const COLORS = { pdf: "#c2412d", image: "#2563c9", bangla: "#0a6b52", developer: "#6d4ac7", text: "#a85f00", calculators: "#0e7490" };

const icon = logo.icon;
const mark = `<svg width="64" height="64" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#0a6b52"/>${icon.tiles
  .map(
    (t) =>
      `<rect x="${t.x}" y="${t.y}" width="${icon.tile}" height="${icon.tile}" rx="${t.r}" fill="${t.role === "spark" ? "#b7f5d8" : "#fff"}"${t.role === "soft" ? ' opacity=".55"' : ""}/>`,
  )
  .join("")}</svg>`;
const word = `<svg height="46" viewBox="${logo.viewBox.join(" ")}">${logo.glyphs
  .map((g) => `<path d="${g.d}" fill="${g.part === "tld" ? "#0a6b52" : "#14231e"}"/>`)
  .join("")}</svg>`;

const chips = (items) => items.map((item) => `<span class="chip">${item}</span>`).join("");

function page({ eyebrow, title, body, art, tags }) {
  return `<!doctype html><html><head><style>
    @font-face { font-family: Jakarta; src: url(${FONTS[500]}); font-weight: 500; }
    @font-face { font-family: Jakarta; src: url(${FONTS[800]}); font-weight: 800; }
    * { box-sizing: border-box; margin: 0; }
    body { width: 1200px; height: 630px; overflow: hidden; font-family: Jakarta, sans-serif; color: #14231e;
      background: #f6f7f4; display: grid; grid-template-columns: 1fr 360px; gap: 40px; padding: 64px 72px; }
    .brand { display: flex; align-items: center; gap: 16px; }
    .eyebrow { margin-top: 56px; color: #0a6b52; font-size: 28px; font-weight: 800; letter-spacing: .01em; }
    h1 { margin-top: 14px; font-size: 76px; line-height: 1.02; font-weight: 800; letter-spacing: -.025em; }
    p { margin-top: 24px; max-width: 640px; color: #52615b; font-size: 30px; line-height: 1.35; font-weight: 500; }
    .chips { display: flex; gap: 12px; margin-top: 36px; }
    .chip { padding: 10px 20px; border-radius: 999px; background: #e1f2eb; color: #085041; font-size: 22px; font-weight: 800; }
    .art { align-self: center; justify-self: end; }
  </style></head><body>
    <div>
      <div class="brand">${mark}${word}</div>
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p>${body}</p>
      <div class="chips">${chips(tags)}</div>
    </div>
    <div class="art">${art}</div>
  </body></html>`;
}

function toolArt(tool) {
  const color = COLORS[tool.hub];
  return `<svg width="340" height="400" viewBox="0 0 340 400">
    <rect x="40" y="40" width="220" height="290" rx="22" fill="#fff" stroke="#d5dbd7" stroke-width="3" transform="rotate(-6 150 185)"/>
    <rect x="80" y="70" width="220" height="290" rx="22" fill="#fff" stroke="#8a9791" stroke-width="3"/>
    <rect x="112" y="110" width="120" height="14" rx="7" fill="#d5dbd7"/>
    <rect x="112" y="140" width="150" height="14" rx="7" fill="#d5dbd7"/>
    <rect x="112" y="170" width="96" height="14" rx="7" fill="#d5dbd7"/>
    <rect x="150" y="226" width="150" height="150" rx="38" fill="${color}"/>
    <svg x="181" y="257" width="88" height="88" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor(tool)}</svg>
  </svg>`;
}

const siteArt = `<svg width="340" height="400" viewBox="0 0 340 400">
  ${["merge-pdf", "split-pdf", "organize-pdf", "jpg-to-pdf"]
    .map((slug, i) => {
      const tool = TOOLS.find((t) => t.slug === slug);
      const hub = tool.hub;
      const x = 30 + (i % 2) * 160;
      const y = 50 + Math.floor(i / 2) * 160;
      return `<rect x="${x}" y="${y}" width="136" height="136" rx="34" fill="${COLORS[hub]}"/>
        <svg x="${x + 36}" y="${y + 36}" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconFor(tool)}</svg>`;
    })
    .join("")}
</svg>`;

const toolPageEyebrow = (tool) => en.hubs[tool.hub].name;

await mkdir("public/og", { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const shoot = async (file, html) => {
  await tab.setContent(html);
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: `public/og/${file}.png` });
};

await shoot(
  "site",
  page({
    eyebrow: "Free online PDF tools",
    title: "PDF jobs, done in seconds",
    body: "Merge, split, organize and convert PDFs on any phone or computer.",
    art: siteArt,
    tags: ["Free", "No signup", "No watermark"],
  }),
);
const built = TOOLS.filter((tool) => tool.built);
for (const tool of built) {
  const strings = en.tools[tool.slug];
  await shoot(tool.slug, page({
      eyebrow: toolPageEyebrow(tool),
      title: strings.name,
      body: strings.description,
      art: toolArt(tool),
      tags: ["Free", "No signup", tool.runsIn === "browser" ? "No upload" : "No watermark"],
    }));
}
await browser.close();
console.log(`Wrote ${built.length + 1} share images.`);
