import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { TOOL_ICONS } from "./icons";
import { HUBS, TOOLS, liveHubs, toolsForHub, validateRegistry, type Tool } from "./tools";

function tool(slug: string, overrides: Partial<Tool> = {}): Tool {
  return { slug, hub: "pdf", related: ["a-b", "c-d", "e-f", "g-h"], aliases: [], live: true, ...overrides };
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
  ])("rejects %s", (_name, tools, message) => {
    expect(() => validateRegistry(tools)).toThrow(message);
  });
});

describe("liveHubs", () => {
  it("publishes a hub only with three live tools of its own", () => {
    const three = ["a", "b", "c"].map((s) => tool(s));
    expect(liveHubs(three).map((h) => h.id)).toEqual(["pdf"]);
    expect(liveHubs(three.slice(0, 2))).toEqual([]);
  });

  it("does not count unpublished tools, variants or also-listed tools", () => {
    const tools = [
      tool("a"),
      tool("b"),
      tool("c", { live: false }),
      tool("d", { variantOf: "a" }),
      tool("e", { hub: "image", alsoIn: ["pdf"] }),
    ];
    expect(liveHubs(tools)).toEqual([]);
  });
});

describe("launch registry", () => {
  it("matches the blueprint route map", () => {
    expect(TOOLS).toHaveLength(22);
    // The blueprint's 20 tools: 19 with one page each, and target-size compression with three.
    expect(TOOLS.filter((t) => !t.variantOf)).toHaveLength(19);
    expect(TOOLS.filter((t) => t.variantOf)).toHaveLength(3);
    expect(HUBS.map((h) => h.slug)).toEqual([
      "pdf-tools",
      "image-tools",
      "bangla-tools",
      "developer-tools",
      "text-tools",
      "calculators",
    ]);
  });

  it("has the six MVP tools live", () => {
    expect(TOOLS.filter((t) => t.live).map((t) => t.slug).sort()).toEqual(
      ["compress-image", "jpg-to-pdf", "merge-pdf", "number-to-bangla-words", "pdf-to-jpg", "split-pdf"],
    );
  });

  it("has only the PDF hub live for the MVP", () => {
    expect(liveHubs().map((h) => h.slug)).toEqual(["pdf-tools"]);
    expect(toolsForHub("pdf").map((t) => t.slug)).toEqual(["merge-pdf", "split-pdf", "jpg-to-pdf", "pdf-to-jpg"]);
  });

  it("has a name and description for every tool, and an icon for every live tool", () => {
    const strings: Record<string, { name: string; description: string }> = en.tools;
    for (const t of TOOLS) {
      expect(strings[t.slug]?.name, t.slug).toBeTruthy();
      expect(strings[t.slug]?.description, t.slug).toBeTruthy();
      if (t.live) expect(TOOL_ICONS[t.slug], t.slug).toBeTruthy();
    }
  });
});
