import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { iconFor } from "./icons";
import { INDEXABLE } from "./site";
import { TOOLS, liveHubs, listedTools, staysOnDevice, toolsForHub, validateRegistry, type Tool } from "./tools";

function tool(slug: string, overrides: Partial<Tool> = {}): Tool {
  return {
    slug,
    hub: "pdf",
    input: "files",
    related: ["a-b", "c-d", "e-f", "g-h"],
    aliases: [],
    built: false,
    runsIn: "browser",
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
  // The site offers PDF tools only, launched one at a time. Other categories come back when they're built.
  it("offers the twenty-eight browser-based PDF tools, with Merge PDF live", () => {
    expect(listedTools().map((t) => t.slug)).toEqual([
      "merge-pdf",
      "split-pdf",
      "compress-pdf",
      "pdf-to-word",
      "pdf-to-powerpoint",
      "pdf-to-excel",
      "jpg-to-pdf",
      "scan-to-pdf",
      "pdf-to-jpg",
      "pdf-to-png",
      "sign-pdf",
      "organize-pdf",
      "rotate-pdf",
      "crop-pdf",
      "remove-pdf-pages",
      "extract-pdf-pages",
      "add-page-numbers",
      "add-watermark",
      "protect-pdf",
      "unlock-pdf",
      "repair-pdf",
      "grayscale-pdf",
      "pdf-to-text",
      "compare-pdf",
      "fill-pdf-forms",
      "redact-pdf",
      "edit-pdf",
      "ocr-pdf",
    ]);
    expect(TOOLS.every((t) => t.hub === "pdf" && t.runsIn === "browser")).toBe(true);
    expect(listedTools().filter((t) => t.built).map((t) => t.slug)).toEqual(["merge-pdf", "split-pdf", "compress-pdf", "pdf-to-word", "pdf-to-powerpoint", "pdf-to-excel", "jpg-to-pdf", "scan-to-pdf", "pdf-to-jpg", "pdf-to-png", "sign-pdf", "organize-pdf", "rotate-pdf", "crop-pdf", "remove-pdf-pages", "extract-pdf-pages", "add-page-numbers", "add-watermark", "protect-pdf", "unlock-pdf", "repair-pdf", "grayscale-pdf", "pdf-to-text", "compare-pdf", "fill-pdf-forms", "redact-pdf", "edit-pdf", "ocr-pdf"]);
  });

  it("publishes only the PDF hub", () => {
    expect(liveHubs().map((h) => h.slug)).toEqual(["pdf-tools"]);
    expect(toolsForHub("pdf")).toHaveLength(28);
  });

  it("has strings and an icon for every tool", () => {
    const strings: Record<string, { name: string; description: string }> = en.tools;
    for (const t of TOOLS) {
      expect(strings[t.slug]?.name, t.slug).toBeTruthy();
      expect(strings[t.slug]?.description, t.slug).toBeTruthy();
      expect(iconFor(t), t.slug).toBeTruthy();
    }
  });

  // Each image type gets its own page, running the JPG to PDF tool, with its own guide so it isn't a copy.
  it("gives each image type its own page that runs JPG to PDF", () => {
    const formats = TOOLS.filter((t) => t.variantOf === "jpg-to-pdf");
    expect(formats.map((t) => t.slug)).toEqual(["image-to-pdf", "png-to-pdf", "heic-to-pdf", "webp-to-pdf", "scan-to-pdf"]);
    for (const format of formats) {
      expect(format.built, format.slug).toBe(true);
      expect(existsSync(`src/content/tools/${format.slug}.md`), format.slug).toBe(true);
      // Only Scan to PDF has its own folder: it adds the camera and cleans each photo, on top of JPG to PDF.
      expect(existsSync(`src/tools/${format.slug}`), format.slug).toBe(format.slug === "scan-to-pdf");
    }
    // Only variants that do a job of their own are listed with the other tools.
    expect(listedTools().filter((t) => t.variantOf).map((t) => t.slug)).toEqual(["scan-to-pdf", "pdf-to-png"]);
  });

  // Unbuilt tools are kept out of search page by page, so the site only needs one working tool to go live.
  it("has a working tool before it is open to search engines", () => {
    if (INDEXABLE) expect(TOOLS.some((t) => t.built)).toBe(true);
  });
});

describe("staysOnDevice", () => {
  it("is true only for tools that run entirely in the browser", () => {
    expect(staysOnDevice(tool("a-b", { runsIn: "browser" }))).toBe(true);
    expect(staysOnDevice(tool("a-b", { runsIn: "server" }))).toBe(false);
  });

  it("covers every built tool, so the privacy promise is never shown by accident", () => {
    for (const t of TOOLS.filter((t) => t.built)) expect(["browser", "server"]).toContain(t.runsIn);
  });
});
