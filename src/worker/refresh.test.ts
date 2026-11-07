import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "./ratings";
import { refreshIfRated } from "./refresh";

const HOOK = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/test";
const NOW = new Date("2026-11-08T00:00:00Z");

function database(updatedAt: string[]): Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../migrations/0001_ratings.sql", import.meta.url), "utf8"));
  updatedAt.forEach((time, index) =>
    sqlite.prepare("INSERT INTO ratings VALUES ('merge-pdf', ?, 5, 'x', ?, ?)").run(`voter${index}`, time, time),
  );
  return {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values: (string | number | null)[] = [];
      const bound = {
        bind(...args: (string | number | null)[]) {
          values = args;
          return bound;
        },
        first: async <T>() => (statement.get(...values) as T | undefined) ?? null,
        all: async <T>() => ({ results: statement.all(...values) as T[] }),
        run: async () => statement.run(...values),
      };
      return bound;
    },
  };
}

describe("refreshIfRated", () => {
  it("rebuilds the site when someone rated in the last day", async () => {
    const fetcher = vi.fn(async () => new Response("{}"));
    const result = await refreshIfRated({ DB: database(["2026-11-07T15:00:00.000Z"]), DEPLOY_HOOK_URL: HOOK }, NOW, fetcher);
    expect(result).toBe("rebuilt");
    expect(fetcher).toHaveBeenCalledWith(HOOK, { method: "POST" });
  });

  it("does nothing on a day without new ratings", async () => {
    const fetcher = vi.fn();
    const result = await refreshIfRated({ DB: database(["2026-11-06T23:59:59.000Z"]), DEPLOY_HOOK_URL: HOOK }, NOW, fetcher);
    expect(result).toBe("unchanged");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does nothing until the deploy hook is set", async () => {
    const fetcher = vi.fn();
    expect(await refreshIfRated({ DB: database(["2026-11-07T15:00:00.000Z"]) }, NOW, fetcher)).toBe("no-hook");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a hook that fails", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      refreshIfRated({ DB: database(["2026-11-07T15:00:00.000Z"]), DEPLOY_HOOK_URL: HOOK }, NOW, fetcher),
    ).rejects.toThrow("Deploy hook answered 404");
  });
});
