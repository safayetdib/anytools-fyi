import type { APIContext } from "astro";
import { llmsTxt } from "../lib/crawl";

export function GET({ site }: APIContext) {
  return new Response(llmsTxt(site as URL), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
