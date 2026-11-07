import type { Database } from "./ratings";

export interface RefreshEnv {
  DB: Database;
  // Cloudflare deploy hook for main. Anyone with it can start a build, so it is a secret.
  DEPLOY_HOOK_URL?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

// Scores are baked into the pages at build time. Once a day, rebuild if anyone rated since the last check.
export async function refreshIfRated(
  env: RefreshEnv,
  now = new Date(),
  fetcher: Fetcher = fetch,
): Promise<"rebuilt" | "unchanged" | "no-hook"> {
  if (!env.DEPLOY_HOOK_URL) return "no-hook";
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM ratings WHERE updated_at >= ?")
    .bind(since)
    .first<{ count: number }>();
  if (!recent?.count) return "unchanged";
  const response = await fetcher(env.DEPLOY_HOOK_URL, { method: "POST" });
  if (!response.ok) throw new Error(`Deploy hook answered ${response.status}`);
  return "rebuilt";
}
