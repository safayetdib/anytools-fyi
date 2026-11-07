import { TOOLS } from "../lib/tools";
import type { RatingSummary } from "../lib/ratings";

// The small part of Cloudflare D1 this API uses.
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface Database {
  prepare(query: string): Statement;
}

export interface RatingsEnv {
  DB: Database;
  // Secret that salts every stored hash. Without it nothing is stored.
  RATING_SALT?: string;
}

export const MAX_DAILY_PER_IP = 20;

const VOTER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BODY = 512;
const RATABLE = new Set(TOOLS.filter((tool) => tool.built).map((tool) => tool.slug));

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function error(status: number, message: string, headers: Record<string, string> = {}) {
  return json({ error: message }, status, headers);
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function summary(row: { count: number; average: number | null } | null): RatingSummary {
  const count = row?.count ?? 0;
  return { count, average: count ? Math.round((row?.average ?? 0) * 100) / 100 : 0 };
}

async function toolSummary(env: RatingsEnv, slug: string): Promise<RatingSummary> {
  return summary(
    await env.DB.prepare("SELECT COUNT(*) AS count, AVG(score) AS average FROM ratings WHERE tool = ?")
      .bind(slug)
      .first<{ count: number; average: number | null }>(),
  );
}

async function allSummaries(env: RatingsEnv): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT tool, COUNT(*) AS count, AVG(score) AS average FROM ratings GROUP BY tool",
  ).all<{ tool: string; count: number; average: number }>();
  const body: Record<string, RatingSummary> = {};
  for (const row of results) if (RATABLE.has(row.tool)) body[row.tool] = summary(row);
  return json(body, 200, { "Cache-Control": "public, max-age=60" });
}

async function readVote(request: Request): Promise<{ score: number; voter: string } | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const { score, voter } = (body ?? {}) as { score?: unknown; voter?: unknown };
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) return null;
  if (typeof voter !== "string" || !VOTER_PATTERN.test(voter)) return null;
  return { score, voter };
}

async function vote(request: Request, env: RatingsEnv, slug: string, now: Date): Promise<Response> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return error(403, "Ratings are only accepted from this site.");
  const salt = env.RATING_SALT;
  if (!salt) return error(503, "Ratings are not set up yet.");
  const input = await readVote(request);
  if (!input) return error(400, "Send a whole-number score from 1 to 5 and a voter id.");

  const voter = await hash(`${salt}:voter:${slug}:${input.voter}`);
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const timestamp = now.toISOString();
  const ipDay = await hash(`${salt}:ip:${slug}:${ip}:${timestamp.slice(0, 10)}`);

  const existing = await env.DB.prepare("SELECT 1 AS found FROM ratings WHERE tool = ? AND voter = ?").bind(slug, voter).first();
  if (!existing) {
    const today = await env.DB.prepare("SELECT COUNT(*) AS count FROM ratings WHERE tool = ? AND ip_day = ?")
      .bind(slug, ipDay)
      .first<{ count: number }>();
    if ((today?.count ?? 0) >= MAX_DAILY_PER_IP) return error(429, "Too many ratings from this connection today.");
  }

  await env.DB.prepare(
    `INSERT INTO ratings (tool, voter, score, ip_day, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tool, voter) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
  )
    .bind(slug, voter, input.score, ipDay, timestamp, timestamp)
    .run();
  return json(await toolSummary(env, slug));
}

// GET /api/ratings, GET /api/ratings/{slug} and POST /api/ratings/{slug}.
export async function handleRatings(request: Request, env: RatingsEnv, now = new Date()): Promise<Response> {
  const match = new URL(request.url).pathname.match(/^\/api\/ratings\/?(?:([a-z0-9-]+)\/?)?$/);
  if (!match) return error(404, "Not found.");
  const slug = match[1];

  if (!slug) {
    if (request.method !== "GET") return error(405, "Method not allowed.", { Allow: "GET" });
    return allSummaries(env);
  }
  if (!RATABLE.has(slug)) return error(404, "This tool can't be rated.");
  if (request.method === "GET") return json(await toolSummary(env, slug), 200, { "Cache-Control": "public, max-age=60" });
  if (request.method === "POST") return vote(request, env, slug, now);
  return error(405, "Method not allowed.", { Allow: "GET, POST" });
}
