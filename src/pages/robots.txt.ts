import type { APIContext } from "astro";
import { robotsTxt } from "../lib/seo";

export function GET({ site }: APIContext) {
  return new Response(robotsTxt(site as URL), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
