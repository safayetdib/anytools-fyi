import type { APIContext } from "astro";
import { sitemapEntries } from "../lib/crawl";
import { sitemapXml } from "../lib/seo";

export async function GET({ site }: APIContext) {
  return new Response(sitemapXml(site as URL, await sitemapEntries()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
