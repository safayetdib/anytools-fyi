import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/styles/tokens.css", "utf8");
const darkStart = css.indexOf("prefers-color-scheme: dark");
const light = readTokens(css.slice(0, darkStart));
const dark = { ...light, ...readTokens(css.slice(darkStart)) };

function readTokens(block: string) {
  const tokens: Record<string, string> = {};
  for (const [, name, hex] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    tokens[name] = hex;
  }
  return tokens;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: [string, string, number][] = [
  ["color-text", "color-bg", 4.5],
  ["color-text", "color-surface", 4.5],
  ["color-text-muted", "color-bg", 4.5],
  ["color-text-muted", "color-surface", 4.5],
  ["color-accent", "color-bg", 4.5],
  ["color-accent", "color-surface", 4.5],
  ["color-on-accent", "color-accent", 4.5],
  ["color-danger", "color-bg", 4.5],
  ["color-danger", "color-surface", 4.5],
  ["color-warning", "color-bg", 4.5],
  ["color-warning", "color-surface", 4.5],
  ["color-border", "color-surface", 3],
  ["color-on-bar", "color-bar", 4.5],
  ["color-on-bar-action", "color-bar-action", 4.5],
  ["color-bar-action", "color-bar", 3],
  ["color-bar-border", "color-bg", 3],
  ["color-on-category", "color-pdf", 3],
  ["color-on-category", "color-image", 3],
  ["color-on-category", "color-bangla", 3],
  ["color-on-category", "color-developer", 3],
  ["color-on-category", "color-text-tools", 3],
  ["color-on-category", "color-calculators", 3],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_theme, tokens) => {
  it.each(pairs)("%s on %s is at least %d:1", (fg, bg, min) => {
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
  });
});
