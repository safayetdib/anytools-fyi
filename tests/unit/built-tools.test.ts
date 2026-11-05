import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/lib/tools";

describe("built tools", () => {
  it.each(TOOLS.filter((t) => !t.variantOf).map((t) => [t.slug, t.built] as const))(
    "%s has a tool module and page content only when marked built",
    (slug, built) => {
      expect(existsSync(`src/tools/${slug}/Tool.astro`)).toBe(built);
      expect(existsSync(`src/content/tools/${slug}.md`)).toBe(built);
    },
  );

  it("marks Merge PDF as built", () => {
    expect(TOOLS.find((t) => t.slug === "merge-pdf")?.built).toBe(true);
  });
});
