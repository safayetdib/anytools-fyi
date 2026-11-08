import en from "../../i18n/en.json";
import { TOOLS, hubFor } from "../tools";
import type { SearchEntry } from "./search";

export function buildSearchEntries(): SearchEntry[] {
  const tools = en.tools as Record<string, { name: string; description: string }>;
  return TOOLS.map((tool) => ({
    slug: tool.slug,
    name: tools[tool.slug].name,
    description: tools[tool.slug].description,
    category: en.hubs[hubFor(tool).id].name,
    aliases: tool.aliases,
    parent: tool.variantOf,
  }));
}
