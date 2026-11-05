import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { iconFor } from "./icons";
import { INDEXABLE } from "./site";
import { HUBS, TOOLS, liveHubs, listedTools, toolsForHub, validateRegistry, variantsOf, type Tool } from "./tools";

function tool(slug: string, overrides: Partial<Tool> = {}): Tool {
  return {
    slug,
    hub: "pdf",
    input: "files",
    related: ["a-b", "c-d", "e-f", "g-h"],
    aliases: [],
    built: false,
    ...overrides,
  };
}

const valid = ["a-b", "c-d", "e-f", "g-h"].map((slug) =>
  tool(slug, { related: ["a-b", "c-d", "e-f", "g-h", "i-j"].filter((s) => s !== slug) }),
);
const validSet = [...valid, tool("i-j")];

describe("validateRegistry", () => {
  it("accepts a valid registry", () => {
    expect(() => validateRegistry(validSet)).not.toThrow();
  });

  it.each([
    ["a duplicate slug", [...validSet, tool("a-b")], /duplicate/i],
    ["an underscore slug", [...validSet, tool("bad_slug")], /slug/i],
    ["an uppercase slug", [...validSet, tool("Bad-Slug")], /slug/i],
    ["an unknown related tool", [...validSet, tool("k-l", { related: ["a-b", "c-d", "e-f", "nope"] })], /related/i],
    ["a tool related to itself", [...validSet, tool("k-l", { related: ["k-l", "a-b", "c-d", "e-f"] })], /itself/i],
    ["too few related tools", [...validSet, tool("k-l", { related: ["a-b", "c-d", "e-f"] })], /at least 4/i],
    ["a variant of an unknown tool", [...validSet, tool("k-l", { variantOf: "nope" })], /variant/i],
  ])("rejects %s", (_name, tools, message) => {
    expect(() => validateRegistry(tools)).toThrow(message);
  });
});

describe("liveHubs", () => {
  it("publishes a hub only with three tools of its own", () => {
    const three = ["a", "b", "c"].map((s) => tool(s));
    expect(liveHubs(three).map((h) => h.id)).toEqual(["pdf"]);
    expect(liveHubs(three.slice(0, 2))).toEqual([]);
  });

  it("does not count variants or also-listed tools", () => {
    const tools = [tool("a"), tool("b"), tool("d", { variantOf: "a" }), tool("e", { hub: "image", alsoIn: ["pdf"] })];
    expect(liveHubs(tools)).toEqual([]);
  });
});

describe("launch registry", () => {
  it("matches the blueprint route map", () => {
    // The blueprint's 20 tools: 19 with one page each, and target-size compression with three.
    expect(TOOLS).toHaveLength(22);
    expect(listedTools()).toHaveLength(19);
    expect(variantsOf(TOOLS.find((t) => t.slug === "compress-image") as Tool)).toHaveLength(3);
    expect(HUBS.map((h) => h.slug)).toEqual([
      "pdf-tools",
      "image-tools",
      "bangla-tools",
      "developer-tools",
      "text-tools",
      "calculators",
    ]);
  });

  it("publishes the four hubs with at least three tools", () => {
    expect(liveHubs().map((h) => h.slug)).toEqual(["pdf-tools", "image-tools", "bangla-tools", "developer-tools"]);
    expect(toolsForHub("pdf").map((t) => t.slug)).toEqual(["merge-pdf", "split-pdf", "jpg-to-pdf", "pdf-to-jpg"]);
    expect(toolsForHub("bangla").map((t) => t.slug)).toContain("word-counter");
  });

  it("has strings and an icon for every tool", () => {
    const strings: Record<string, { name: string; description: string }> = en.tools;
    for (const t of TOOLS) {
      expect(strings[t.slug]?.name, t.slug).toBeTruthy();
      expect(strings[t.slug]?.description, t.slug).toBeTruthy();
      expect(iconFor(t), t.slug).toBeTruthy();
    }
  });

  it("stays out of search until every tool is built", () => {
    if (INDEXABLE) expect(TOOLS.filter((t) => !t.built).map((t) => t.slug)).toEqual([]);
  });
});
