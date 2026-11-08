import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_DAILY_PER_IP, handleRatings, type Database, type RatingsEnv } from "./ratings";

const ORIGIN = "https://anytools.fyi";
const VOTER = "0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const OTHER = "1c8d2e3f-4051-4b6c-9d7e-8f9a0b1c2d3e";

// Runs the real migration on Node's built-in SQLite, behind the small part of D1 the API uses.
function testDatabase(): { db: Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../../migrations/0001_ratings.sql", import.meta.url), "utf8"));
  const db: Database = {
    prepare(query) {
      const statement = sqlite.prepare(query);
      let values: (string | number | null)[] = [];
      const bound = {
        bind(...args: (string | number | null)[]) {
          values = args;
          return bound;
        },
        async first<T>() {
          return (statement.get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          statement.run(...values);
          return {};
        },
      };
      return bound;
    },
  };
  return { db, sqlite };
}

let env: RatingsEnv;
let sqlite: DatabaseSync;

beforeEach(() => {
  const test = testDatabase();
  sqlite = test.sqlite;
  env = { DB: test.db, RATING_SALT: "test-salt" };
});

function rate(slug: string, body: unknown, headers: Record<string, string> = {}, now?: Date) {
  const request = new Request(`${ORIGIN}/api/ratings/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return handleRatings(request, env, now);
}

describe("POST /api/ratings/{slug}", () => {
  it("saves a rating and returns the tool's new average", async () => {
    const response = await rate("merge-pdf", { score: 4, voter: VOTER });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 1, average: 4 });
  });

  it("replaces a voter's earlier rating instead of adding another", async () => {
    await rate("merge-pdf", { score: 2, voter: VOTER });
    const response = await rate("merge-pdf", { score: 5, voter: VOTER });
    expect(await response.json()).toEqual({ count: 1, average: 5 });
  });

  it("averages different voters to two decimals", async () => {
    await rate("merge-pdf", { score: 5, voter: VOTER });
    await rate("merge-pdf", { score: 4, voter: OTHER });
    const third = await rate("merge-pdf", { score: 4, voter: "2d9e3f40-5162-4c7d-8e8f-9a0b1c2d3e4f" });
    expect(await third.json()).toEqual({ count: 3, average: 4.33 });
  });

  it("never stores the voter id or the IP address as they are", async () => {
    await rate("merge-pdf", { score: 4, voter: VOTER });
    const row = sqlite.prepare("SELECT * FROM ratings").get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain(VOTER);
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
    expect(row.voter).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_day).toMatch(/^[0-9a-f]{64}$/);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("refuses tools that aren't built or don't exist", async () => {
    expect((await rate("rotate-pdf", { score: 5, voter: VOTER })).status).toBe(404);
    expect((await rate("no-such-tool", { score: 5, voter: VOTER })).status).toBe(404);
  });

  it.each([0, 6, 3.5, "5", null])("refuses the score %s", async (score) => {
    expect((await rate("merge-pdf", { score, voter: VOTER })).status).toBe(400);
  });

  it.each(["", "not-a-uuid", `${VOTER}x`, 42])("refuses the voter id %s", async (voter) => {
    expect((await rate("merge-pdf", { score: 5, voter })).status).toBe(400);
  });

  it("refuses a body that isn't JSON", async () => {
    expect((await rate("merge-pdf", "score=5")).status).toBe(400);
  });

  it("refuses requests from other sites", async () => {
    expect((await rate("merge-pdf", { score: 5, voter: VOTER }, { Origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = new Request(`${ORIGIN}/api/ratings/merge-pdf`, {
      method: "POST",
      body: JSON.stringify({ score: 5, voter: VOTER }),
    });
    expect((await handleRatings(noOrigin, env)).status).toBe(403);
  });

  it("stores nothing when the salt isn't set", async () => {
    env = { ...env, RATING_SALT: undefined };
    expect((await rate("merge-pdf", { score: 5, voter: VOTER })).status).toBe(503);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM ratings").get()).toEqual({ n: 0 });
  });

  it("limits new ratings from one IP address per tool per day", async () => {
    const day = new Date("2026-11-07T10:00:00Z");
    for (let i = 0; i < MAX_DAILY_PER_IP; i++) {
      const voter = `0b7c1d2e-3f40-4a5b-8c6d-${String(i).padStart(12, "0")}`;
      expect((await rate("merge-pdf", { score: 5, voter }, {}, day)).status).toBe(200);
    }
    expect((await rate("merge-pdf", { score: 5, voter: OTHER }, {}, day)).status).toBe(429);
    // An existing voter can still change their score.
    const voter = "0b7c1d2e-3f40-4a5b-8c6d-000000000000";
    expect((await rate("merge-pdf", { score: 3, voter }, {}, day)).status).toBe(200);
    // Another address, or the next day, is fine.
    expect((await rate("merge-pdf", { score: 5, voter: OTHER }, { "CF-Connecting-IP": "198.51.100.1" }, day)).status).toBe(200);
    const nextDay = new Date("2026-11-08T00:00:01Z");
    expect((await rate("merge-pdf", { score: 5, voter: "3e0f4051-6273-4d8e-9f90-0b1c2d3e4f50" }, {}, nextDay)).status).toBe(200);
  });
});

describe("GET /api/ratings", () => {
  it("returns every rated built tool", async () => {
    await rate("merge-pdf", { score: 5, voter: VOTER });
    await rate("merge-pdf", { score: 4, voter: OTHER });
    const response = await handleRatings(new Request(`${ORIGIN}/api/ratings`), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ "merge-pdf": { count: 2, average: 4.5 } });
  });

  it("returns one tool, with zero ratings when it has none", async () => {
    const response = await handleRatings(new Request(`${ORIGIN}/api/ratings/merge-pdf`), env);
    expect(await response.json()).toEqual({ count: 0, average: 0 });
  });

  it("answers other methods and paths with an error", async () => {
    expect((await handleRatings(new Request(`${ORIGIN}/api/ratings`, { method: "DELETE" }), env)).status).toBe(405);
    expect((await handleRatings(new Request(`${ORIGIN}/api/nope`), env)).status).toBe(404);
  });
});
