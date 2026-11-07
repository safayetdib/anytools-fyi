import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MIN_SHOWN_RATINGS, aggregateRatingSchema, formatAverage, shownRating } from "./ratings";
import { fetchRatings, parseRatings } from "./ratings-source";

describe("shownRating", () => {
  it("hides a tool until it has enough ratings", () => {
    expect(shownRating(undefined)).toBeNull();
    expect(shownRating({ count: MIN_SHOWN_RATINGS - 1, average: 5 })).toBeNull();
    expect(shownRating({ count: MIN_SHOWN_RATINGS, average: 4.2 })).toEqual({ count: MIN_SHOWN_RATINGS, average: 4.2 });
  });
});

describe("formatAverage", () => {
  it.each([
    [4.78, "4.8"],
    [5, "5.0"],
    [4.25, "4.3"],
    [3.04, "3.0"],
  ])("shows %s as %s", (average, text) => expect(formatAverage(average)).toBe(text));
});

describe("aggregateRatingSchema", () => {
  it("gives Google the same score the page shows", () => {
    expect(aggregateRatingSchema({ count: 23, average: 4.78 })).toEqual({
      "@type": "AggregateRating",
      ratingValue: "4.8",
      ratingCount: 23,
      bestRating: "5",
      worstRating: "1",
    });
  });
});

describe("parseRatings", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(
      parseRatings({
        "merge-pdf": { count: 7, average: 4.5 },
        "split-pdf": { count: "7", average: 4 },
        "rotate-pdf": { count: 3, average: 9 },
        "bad slug!": { count: 3, average: 4 },
      }),
    ).toEqual({ "merge-pdf": { count: 7, average: 4.5 } });
    expect(parseRatings(null)).toEqual({});
    expect(parseRatings([1, 2])).toEqual({});
  });
});

describe("fetchRatings", () => {
  it("loads nothing outside Cloudflare builds", async () => {
    const fetcher = vi.fn();
    expect(await fetchRatings({}, fetcher)).toEqual({});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads the live scores in a Cloudflare build", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ "merge-pdf": { count: 9, average: 4.9 } })));
    expect(await fetchRatings({ WORKERS_CI: "1" }, fetcher)).toEqual({ "merge-pdf": { count: 9, average: 4.9 } });
    expect(fetcher).toHaveBeenCalledWith("https://anytools.fyi/api/ratings", expect.anything());
  });

  it("carries on without ratings when the live scores can't be read", async () => {
    expect(await fetchRatings({ WORKERS_CI: "1" }, async () => new Response("down", { status: 500 }))).toEqual({});
    expect(
      await fetchRatings({ WORKERS_CI: "1" }, async () => {
        throw new Error("offline");
      }),
    ).toEqual({});
  });

  it("reads a local file when RATINGS_FILE is set", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "ratings-")), "ratings.json");
    writeFileSync(file, JSON.stringify({ "merge-pdf": { count: 12, average: 4.6 } }));
    expect(await fetchRatings({ RATINGS_FILE: file, WORKERS_CI: "1" }, vi.fn())).toEqual({ "merge-pdf": { count: 12, average: 4.6 } });
  });
});
