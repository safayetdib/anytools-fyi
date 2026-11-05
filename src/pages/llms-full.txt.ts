import type { APIContext } from "astro";
import { llmsFullTxt } from "../lib/crawl";

export async function GET({ site }: APIContext) {
  return new Response(await llmsFullTxt(site as URL), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
