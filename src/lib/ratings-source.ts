import { readFile } from "node:fs/promises";
import type { RatingSummary } from "./ratings";

const LIVE_RATINGS = "https://anytools.fyi/api/ratings";
const TIMEOUT_MS = 5000;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function parseRatings(data: unknown): Record<string, RatingSummary> {
  const ratings: Record<string, RatingSummary> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return ratings;
  for (const [slug, value] of Object.entries(data)) {
    const { count, average } = (value ?? {}) as Partial<RatingSummary>;
    if (!/^[a-z0-9-]+$/.test(slug)) continue;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) continue;
    if (typeof average !== "number" || average < 0 || average > 5) continue;
    ratings[slug] = { count, average };
  }
  return ratings;
}

// Scores are baked into the pages at build time, so showing them costs nothing per visit.
// Only Cloudflare builds read the live scores; a failure there leaves the pages without ratings.
export async function fetchRatings(
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<Record<string, RatingSummary>> {
  try {
    if (env.RATINGS_FILE) return parseRatings(JSON.parse(await readFile(env.RATINGS_FILE, "utf8")));
    if (env.WORKERS_CI !== "1") return {};
    const response = await fetcher(LIVE_RATINGS, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseRatings(await response.json());
  } catch (cause) {
    console.warn(`Ratings not loaded, building without them: ${String(cause)}`);
    return {};
  }
}

let loaded: Promise<Record<string, RatingSummary>> | undefined;

// One request per build, however many pages use it.
export function loadRatings(): Promise<Record<string, RatingSummary>> {
  loaded ??= fetchRatings();
  return loaded;
}
