import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import {
  hubMeta,
  indexableHubs,
  indexableTools,
  isToolIndexable,
  robotsTxt,
  sitemapXml,
  toolMeta,
} from "./seo";
import { HUBS, TOOLS, toolBySlug, type Tool } from "./tools";

const site = new URL("https://anytools.fyi");
const merge = toolBySlug("merge-pdf") as Tool;
const split = toolBySlug("split-pdf") as Tool;

describe("indexing", () => {
  it("indexes built tools only", () => {
    expect(isToolIndexable(merge)).toBe(true);
    expect(isToolIndexable(split)).toBe(false);
    expect(indexableTools().every((tool) => tool.built)).toBe(true);
  });

  it("indexes a hub only when it has a built tool", () => {
    const ids = indexableHubs().map((hub) => hub.id);
    expect(ids).toContain("pdf");
    for (const hub of HUBS) {
      const hasBuilt = TOOLS.some((tool) => tool.built && (tool.hub === hub.id || tool.alsoIn?.includes(hub.id)));
      if (!hasBuilt) expect(ids).not.toContain(hub.id);
    }
  });
});

// Search engines cut titles past about 60 characters and descriptions past about 160.
const fits = ({ title, description }: { title: string; description: string }) => {
  expect(title.length, title).toBeLessThanOrEqual(60);
  expect(description.length, description).toBeGreaterThanOrEqual(70);
  expect(description.length, description).toBeLessThanOrEqual(160);
};

describe("titles and descriptions", () => {
  it("fit search results on the home and All tools pages", () => {
    fits({ title: en.site.title, description: en.site.tagline });
    fits({ title: en.allTools.title, description: en.allTools.description });
  });

  it("fit search results on every indexed tool and hub", () => {
    for (const tool of indexableTools()) fits(toolMeta(tool));
    for (const hub of indexableHubs()) fits(hubMeta(hub));
  });

  it("fit search results on every info page", () => {
    const dir = "src/pages";
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".md"))) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      const title = `${/title: "(.*)"/.exec(text)?.[1]} | ${en.site.name}`;
      const description = /description: "(.*)"/.exec(text)?.[1] ?? "";
      fits({ title, description });
    }
  });

  it("are unique across indexed pages", () => {
    const titles = [en.site.title, en.allTools.title, ...indexableTools().map((t) => toolMeta(t).title), ...indexableHubs().map((h) => hubMeta(h).title)];
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("only promise no upload for tools that stay on the device", () => {
    expect(toolMeta(merge).title).toMatch(/No Upload/);
    expect(toolMeta({ ...merge, runsIn: "server" }).title).not.toMatch(/Upload/);
    expect(toolMeta({ ...merge, runsIn: "server" }).description).not.toMatch(/upload/i);
  });
});

describe("crawler files", () => {
  it("lists pages in the sitemap with escaped URLs and dates", () => {
    const xml = sitemapXml(site, [
      { path: "/", lastmod: "2026-11-06" },
      { path: "/merge-pdf/" },
    ]);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<loc>https://anytools.fyi/</loc><lastmod>2026-11-06</lastmod>");
    expect(xml).toContain("<loc>https://anytools.fyi/merge-pdf/</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });

  it("lets every crawler in and points to the sitemap", () => {
    const text = robotsTxt(site);
    expect(text).toContain("User-agent: *\nAllow: /");
    expect(text).toContain("Sitemap: https://anytools.fyi/sitemap.xml");
    expect(text).not.toMatch(/Disallow: \/\s*$/m);
  });
});

// The brand reads "AnyTools" in text. "AnyTools.fyi" is kept for where the address matters:
// page titles, the site name for share cards, the logo's accessible name and the copyright line.
describe("brand name", () => {
  const strings: [string, string][] = [];
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") strings.push([key, value]);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${key}.${k}`);
  };
  walk(en, "en");
  const addressKeys = new Set(["en.site.name", "en.a11y.home"]);

  it("uses AnyTools.fyi only in titles and the address", () => {
    for (const [key, text] of strings) {
      if (!text.includes("AnyTools.fyi") || addressKeys.has(key)) continue;
      expect(/(\| AnyTools\.fyi$|^AnyTools\.fyi: )/.test(text), `${key}: ${text}`).toBe(true);
    }
  });

  it("never writes the name in lower case or as two words in text", () => {
    for (const [key, text] of strings) expect(text, key).not.toMatch(/\banytools\b(?!\.fyi\/)|Any Tools/);
  });

  it("uses AnyTools in the info pages' text", () => {
    for (const file of readdirSync("src/pages").filter((name) => name.endsWith(".md"))) {
      expect(readFileSync(`src/pages/${file}`, "utf8"), file).not.toContain("AnyTools.fyi");
    }
  });
});
