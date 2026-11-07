import { handleRatings, type RatingsEnv } from "./ratings";

interface Env extends RatingsEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// Runs only for /api/* (see run_worker_first in wrangler.jsonc). Everything else is served as plain files.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/api/ratings")) {
      try {
        return await handleRatings(request, env);
      } catch {
        return new Response(JSON.stringify({ error: "Something went wrong." }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
