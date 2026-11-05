import en from "../i18n/en.json";
import { fill } from "../i18n/format";
import { HUBS, TOOLS, staysOnDevice, toolsForHub, type Hub, type Tool } from "./tools";

type ToolStrings = { name: string; description: string; title?: string; metaDescription?: string };
const toolStrings = en.tools as Record<string, ToolStrings>;
const hubStrings = en.hubs as Record<string, { title: string; description: string }>;
const p = en.toolPage;

/** Only working tools are offered to search engines. Coming-soon pages stay out until they're built. */
export function isToolIndexable(tool: Tool): boolean {
  return tool.built;
}

export function indexableTools(): Tool[] {
  return TOOLS.filter(isToolIndexable);
}

/** A category page is worth indexing once it lists at least one working tool. */
export function indexableHubs(): Hub[] {
  return HUBS.filter((hub) => toolsForHub(hub.id).some(isToolIndexable));
}

export function isHubIndexable(hub: Hub): boolean {
  return indexableHubs().some((other) => other.id === hub.id);
}

/** A tool's title and description. A hand-written title wins; the promise of no upload needs a browser-only tool. */
export function toolMeta(tool: Tool): { title: string; description: string } {
  const strings = toolStrings[tool.slug];
  const local = staysOnDevice(tool);
  const isText = tool.input === "text";
  const title =
    local && strings.title
      ? strings.title
      : fill(local ? (isText ? p.titleText : p.titleFiles) : p.titlePlain, { name: strings.name });
  const description =
    local && strings.metaDescription
      ? strings.metaDescription
      : `${strings.description} ${local ? p.metaSuffix : p.metaSuffixPlain}`;
  return { title, description };
}

export function hubMeta(hub: Hub): { title: string; description: string } {
  return hubStrings[hub.id];
}

export interface SitemapEntry {
  path: string;
  lastmod?: string;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function sitemapXml(site: URL, entries: SitemapEntry[]): string {
  const urls = entries
    .map(({ path, lastmod }) => {
      const loc = `<loc>${escapeXml(new URL(path, site).href)}</loc>`;
      return `<url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Every crawler is welcome, AI search crawlers included, so answers can point people to the tools. */
export function robotsTxt(site: URL): string {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${new URL("/sitemap.xml", site).href}`, ""].join("\n");
}
