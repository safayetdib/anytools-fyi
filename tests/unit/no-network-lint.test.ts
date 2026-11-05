import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

async function errorCount(code: string, filePath: string) {
  const [result] = await new ESLint().lintText(code, { filePath });
  return result.errorCount;
}

describe("no-network lint rule", () => {
  it.each([
    ["fetch", 'fetch("/x");'],
    ["XMLHttpRequest", "new XMLHttpRequest();"],
    ["WebSocket", 'new WebSocket("wss://x");'],
    ["sendBeacon", 'navigator.sendBeacon("/x");'],
    ["window.fetch", 'window.fetch("/x");'],
  ])("blocks %s in tool code", async (_name, code) => {
    expect(await errorCount(code, "src/tools/merge-pdf/ui.ts")).toBeGreaterThan(0);
  });

  it("allows the same call outside tool code", async () => {
    expect(await errorCount('fetch("/x");', "src/lib/search.ts")).toBe(0);
  });
});
