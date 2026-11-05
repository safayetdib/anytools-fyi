// Builds the logo data and the icon files from one source.
// The wordmark is turned into SVG shapes here, so pages never load a web font for it.
// Run with: node scripts/build-logo.mjs
import { readFile, writeFile } from "node:fs/promises";
import opentype from "opentype.js";
import { chromium } from "@playwright/test";

const FONT = "node_modules/@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-800-normal.woff";
const SIZE = 100;
const TRACKING = -2; // -0.02em
const PARTS = [
  { text: "anytools", part: "name" },
  { text: ".fyi", part: "tld" },
];

// The icon: four tiles on a rounded square, the top-right one round.
const ICON = {
  size: 32,
  radius: 9,
  tiles: [
    { x: 7, y: 7, r: 2.5, role: "tile" },
    { x: 7, y: 17, r: 2.5, role: "soft" },
    { x: 17, y: 17, r: 2.5, role: "tile" },
    { x: 17, y: 7, r: 4, role: "spark" },
  ],
  tile: 8,
};
const BRAND = { accent: "#0a6b52", tile: "#ffffff", spark: "#b7f5d8" };

const round = (n) => Math.round(n * 100) / 100;

const buffer = await readFile(FONT);
const font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const scale = SIZE / font.unitsPerEm;

const glyphs = [];
let x = 0;
let top = Infinity;
let bottom = -Infinity;
for (const { text, part } of PARTS) {
  for (const char of text) {
    const glyph = font.charToGlyph(char);
    const path = glyph.getPath(x, 0, SIZE);
    const box = path.getBoundingBox();
    top = Math.min(top, box.y1);
    bottom = Math.max(bottom, box.y2);
    const advance = glyph.advanceWidth * scale + TRACKING;
    glyphs.push({ char, part, d: path.toPathData(2), end: round(box.x2) });
    x += advance;
  }
}

const left = 0;
const right = Math.max(...glyphs.map((glyph) => glyph.end));
const pad = 2;
const data = {
  viewBox: [round(left - pad), round(top - pad), round(right - left + pad * 2 + 10), round(bottom - top + pad * 2)],
  capTop: round(top),
  baseline: 0,
  glyphs,
  icon: ICON,
};
await writeFile("src/components/logo-data.json", JSON.stringify(data, null, 2) + "\n");

const tileRects = (colors) =>
  ICON.tiles
    .map(
      (tile) =>
        `<rect x="${tile.x}" y="${tile.y}" width="${ICON.tile}" height="${ICON.tile}" rx="${tile.r}" fill="${tile.role === "spark" ? colors.spark : colors.tile}"${tile.role === "soft" ? ' opacity=".55"' : ""}/>`,
    )
    .join("");

const iconSvg = (radius = ICON.radius) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${radius}" fill="${BRAND.accent}"/>${tileRects(BRAND)}</svg>`;

// Android crops maskable icons to a circle or squircle, so the tiles shrink into the middle 80%.
const maskableSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BRAND.accent}"/><g transform="translate(16 16) scale(0.72) translate(-16 -16)">${tileRects(BRAND)}</g></svg>`;

await writeFile("public/favicon.svg", iconSvg() + "\n");

// PNG icons: the Apple touch icon is square, because iOS rounds the corners itself.
const browser = await chromium.launch();
const page = await browser.newPage();
const png = async (file, px, svg) => {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${svg}`);
  return page.screenshot({ path: file, omitBackground: true });
};
await png("public/apple-touch-icon.png", 180, iconSvg(0));
await png("public/icon-192.png", 192, iconSvg());
await png("public/icon-512.png", 512, iconSvg());
await png("public/icon-maskable-512.png", 512, maskableSvg());

// favicon.ico for older browsers and tools that ask for it by name: 16, 32 and 48px PNGs in one file.
const sizes = [16, 32, 48];
const images = [];
for (const px of sizes) images.push(await png(undefined, px, iconSvg()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((px, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(px, entry);
  header.writeUInt8(px, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile("public/favicon.ico", Buffer.concat([header, ...images]));
await browser.close();

console.log(`Wrote logo data (${glyphs.length} glyphs) and icons.`);
