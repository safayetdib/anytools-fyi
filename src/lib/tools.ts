export type HubId = "pdf" | "image" | "bangla" | "developer" | "text" | "calculators";

export interface Hub {
  id: HubId;
  slug: string;
  color: string;
}

export interface Tool {
  slug: string;
  hub: HubId;
  input: "files" | "text";
  alsoIn?: HubId[];
  related: string[];
  aliases: string[];
  // True once the tool works. Unbuilt tools show as coming soon and stay out of search.
  built: boolean;
  // Where the work happens. Only "browser" tools may promise that files stay on the device.
  runsIn: "browser" | "server";
  variantOf?: string;
}

const MIN_RELATED_TOOLS = 4;
const MIN_HUB_TOOLS = 3;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const HUBS: Hub[] = [
  { id: "pdf", slug: "pdf-tools", color: "var(--color-pdf)" },
  { id: "image", slug: "image-tools", color: "var(--color-image)" },
  { id: "bangla", slug: "bangla-tools", color: "var(--color-bangla)" },
  { id: "developer", slug: "developer-tools", color: "var(--color-developer)" },
  { id: "text", slug: "text-tools", color: "var(--color-text-tools)" },
  { id: "calculators", slug: "calculators", color: "var(--color-calculators)" },
];

// The PDF tools the site offers, most used first. Only built ones work; the rest show as coming soon.
// Every tool runs in the browser. Other categories return here when their tools are ready to launch.
export const TOOLS: Tool[] = [
  {
    slug: "merge-pdf",
    hub: "pdf",
    input: "files",
    related: ["split-pdf", "organize-pdf", "jpg-to-pdf", "remove-pdf-pages"],
    aliases: ["combine pdf", "join pdf", "pdf merger", "merge pdf files", "পিডিএফ যুক্ত করুন", "pdf jukto"],
    built: true,
    runsIn: "browser",
  },
  {
    slug: "split-pdf",
    hub: "pdf",
    input: "files",
    related: ["extract-pdf-pages", "remove-pdf-pages", "merge-pdf", "organize-pdf"],
    aliases: ["split pdf pages", "separate pdf", "divide pdf", "pdf splitter", "pdf cutter", "পিডিএফ ভাগ করুন"],
    built: true,
    runsIn: "browser",
  },
  {
    slug: "jpg-to-pdf",
    hub: "pdf",
    input: "files",
    related: ["pdf-to-jpg", "merge-pdf", "organize-pdf", "rotate-pdf"],
    aliases: ["image to pdf", "photo to pdf", "png to pdf", "pictures to pdf", "scan to pdf", "ছবি থেকে পিডিএফ"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "pdf-to-jpg",
    hub: "pdf",
    input: "files",
    related: ["jpg-to-pdf", "extract-pdf-pages", "split-pdf", "merge-pdf"],
    aliases: ["pdf to image", "pdf to png", "pdf to picture", "save pdf as image", "পিডিএফ থেকে ছবি"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "organize-pdf",
    hub: "pdf",
    input: "files",
    related: ["rotate-pdf", "remove-pdf-pages", "merge-pdf", "split-pdf"],
    aliases: ["reorder pdf pages", "rearrange pdf", "sort pdf pages", "move pdf pages", "organise pdf"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "rotate-pdf",
    hub: "pdf",
    input: "files",
    related: ["organize-pdf", "merge-pdf", "remove-pdf-pages", "add-page-numbers"],
    aliases: ["turn pdf pages", "rotate pdf pages", "fix sideways pdf", "flip pdf"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "remove-pdf-pages",
    hub: "pdf",
    input: "files",
    related: ["extract-pdf-pages", "organize-pdf", "split-pdf", "merge-pdf"],
    aliases: ["delete pdf pages", "remove pages from pdf", "delete page from pdf", "erase pdf page", "পিডিএফ পৃষ্ঠা মুছুন"],
    built: true,
    runsIn: "browser",
  },
  {
    slug: "extract-pdf-pages",
    hub: "pdf",
    input: "files",
    related: ["split-pdf", "remove-pdf-pages", "pdf-to-jpg", "merge-pdf"],
    aliases: ["extract pages", "save pdf pages", "copy pages from pdf", "pull pages out of pdf"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "add-page-numbers",
    hub: "pdf",
    input: "files",
    related: ["add-watermark", "merge-pdf", "organize-pdf", "rotate-pdf"],
    aliases: ["number pdf pages", "pdf page numbers", "paginate pdf", "page numbering"],
    built: false,
    runsIn: "browser",
  },
  {
    slug: "add-watermark",
    hub: "pdf",
    input: "files",
    related: ["add-page-numbers", "merge-pdf", "rotate-pdf", "organize-pdf"],
    aliases: ["watermark pdf", "stamp pdf", "pdf watermark", "confidential stamp", "draft stamp"],
    built: false,
    runsIn: "browser",
  },
];

export function validateRegistry(tools: Tool[]): void {
  const slugs = new Set<string>();
  for (const tool of tools) {
    if (!SLUG_PATTERN.test(tool.slug)) throw new Error(`Bad slug: "${tool.slug}"`);
    if (slugs.has(tool.slug)) throw new Error(`Duplicate slug: "${tool.slug}"`);
    slugs.add(tool.slug);
  }
  for (const tool of tools) {
    if (tool.related.includes(tool.slug)) throw new Error(`"${tool.slug}" is related to itself`);
    if (tool.related.length < MIN_RELATED_TOOLS) {
      throw new Error(`"${tool.slug}" needs at least ${MIN_RELATED_TOOLS} related tools`);
    }
    const unknown = tool.related.find((slug) => !slugs.has(slug));
    if (unknown) throw new Error(`"${tool.slug}" has an unknown related tool: "${unknown}"`);
    if (tool.variantOf && !slugs.has(tool.variantOf)) {
      throw new Error(`"${tool.slug}" is a variant of an unknown tool: "${tool.variantOf}"`);
    }
  }
}

validateRegistry(TOOLS);

// Tools that get their own card. Variant pages are reached from their parent tool instead.
export function listedTools(tools: Tool[] = TOOLS): Tool[] {
  return tools.filter((tool) => !tool.variantOf);
}

/** True when the tool does all its work in the browser, so files never leave the device. */
export function staysOnDevice(tool: Tool): boolean {
  return tool.runsIn === "browser";
}

export function toolBySlug(slug: string): Tool | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}

export function variantsOf(tool: Tool, tools: Tool[] = TOOLS): Tool[] {
  return tools.filter((other) => other.variantOf === tool.slug);
}

export function isHubLive(hubId: HubId): boolean {
  return liveHubs().some((hub) => hub.id === hubId);
}

export function liveHubs(tools: Tool[] = TOOLS): Hub[] {
  return HUBS.filter(
    (hub) => listedTools(tools).filter((tool) => tool.hub === hub.id).length >= MIN_HUB_TOOLS,
  );
}

export function toolsForHub(hubId: HubId, tools: Tool[] = TOOLS): Tool[] {
  return listedTools(tools).filter((tool) => tool.hub === hubId || tool.alsoIn?.includes(hubId));
}

export function hubFor(tool: Tool): Hub {
  return HUBS.find((hub) => hub.id === tool.hub) as Hub;
}
