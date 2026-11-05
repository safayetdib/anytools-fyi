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
  // True once the tool works. Launch waits until every tool is built.
  built: boolean;
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

// Listed most used first. This order is an estimate until analytics replace it.
export const TOOLS: Tool[] = [
  {
    slug: "merge-pdf",
    hub: "pdf",
    input: "files",
    related: ["split-pdf", "jpg-to-pdf", "pdf-to-jpg", "compress-image"],
    aliases: ["combine pdf", "join pdf", "pdf merger", "পিডিএফ যুক্ত করুন", "pdf jukto"],
    built: false,
  },
  {
    slug: "compress-image",
    hub: "image",
    input: "files",
    related: ["compress-image-to-20kb", "resize-image", "convert-image", "jpg-to-pdf"],
    aliases: ["reduce image size", "shrink photo", "ছবির সাইজ কমান", "chobir size komano"],
    built: false,
  },
  {
    slug: "split-pdf",
    hub: "pdf",
    input: "files",
    related: ["merge-pdf", "pdf-to-jpg", "jpg-to-pdf", "compress-image"],
    aliases: ["extract pdf pages", "separate pdf", "পিডিএফ ভাগ করুন"],
    built: false,
  },
  {
    slug: "jpg-to-pdf",
    hub: "pdf",
    input: "files",
    related: ["pdf-to-jpg", "merge-pdf", "compress-image", "heic-to-jpg"],
    aliases: ["images to pdf", "png to pdf", "photo to pdf", "ছবি থেকে পিডিএফ"],
    built: false,
  },
  {
    slug: "pdf-to-jpg",
    hub: "pdf",
    input: "files",
    related: ["jpg-to-pdf", "split-pdf", "merge-pdf", "compress-image"],
    aliases: ["pdf to image", "pdf to png", "পিডিএফ থেকে ছবি"],
    built: false,
  },
  {
    slug: "number-to-bangla-words",
    hub: "bangla",
    input: "text",
    related: ["bijoy-to-unicode", "bangla-date-converter", "word-counter", "age-calculator"],
    aliases: ["amount in words bangla", "সংখ্যা থেকে কথায়", "taka in words", "টাকা কথায়", "shongkha kothay"],
    built: false,
  },
  {
    slug: "resize-image",
    hub: "image",
    input: "files",
    related: ["compress-image", "convert-image", "photo-signature-resizer", "remove-image-metadata"],
    aliases: ["change image dimensions", "scale photo", "ছবি রিসাইজ"],
    built: false,
  },
  {
    slug: "compress-image-to-20kb",
    hub: "image",
    input: "files",
    related: ["compress-image-to-50kb", "compress-image-to-100kb", "compress-image", "photo-signature-resizer"],
    aliases: ["20 kb photo", "ছবি ২০ কেবি"],
    built: false,
    variantOf: "compress-image",
  },
  {
    slug: "compress-image-to-50kb",
    hub: "image",
    input: "files",
    related: ["compress-image-to-20kb", "compress-image-to-100kb", "compress-image", "photo-signature-resizer"],
    aliases: ["50 kb photo", "ছবি ৫০ কেবি"],
    built: false,
    variantOf: "compress-image",
  },
  {
    slug: "compress-image-to-100kb",
    hub: "image",
    input: "files",
    related: ["compress-image-to-20kb", "compress-image-to-50kb", "compress-image", "photo-signature-resizer"],
    aliases: ["100 kb photo", "ছবি ১০০ কেবি"],
    built: false,
    variantOf: "compress-image",
  },
  {
    slug: "photo-signature-resizer",
    hub: "image",
    input: "files",
    alsoIn: ["bangla"],
    related: ["compress-image-to-20kb", "resize-image", "compress-image", "jpg-to-pdf"],
    aliases: ["job application photo", "form photo size", "ছবি ও স্বাক্ষর", "teletalk photo"],
    built: false,
  },
  {
    slug: "convert-image",
    hub: "image",
    input: "files",
    related: ["heic-to-jpg", "compress-image", "resize-image", "jpg-to-pdf"],
    aliases: ["png to jpg", "jpg to png", "webp to jpg", "image converter"],
    built: false,
  },
  {
    slug: "heic-to-jpg",
    hub: "image",
    input: "files",
    related: ["convert-image", "compress-image", "jpg-to-pdf", "remove-image-metadata"],
    aliases: ["iphone photo to jpg", "heif to jpg"],
    built: false,
  },
  {
    slug: "remove-image-metadata",
    hub: "image",
    input: "files",
    related: ["compress-image", "resize-image", "convert-image", "heic-to-jpg"],
    aliases: ["remove exif", "strip photo location", "exif remover"],
    built: false,
  },
  {
    slug: "qr-code-generator",
    hub: "image",
    input: "text",
    related: ["password-generator", "base64-encode-decode", "convert-image", "word-counter"],
    aliases: ["make qr code", "qr maker", "কিউআর কোড"],
    built: false,
  },
  {
    slug: "bijoy-to-unicode",
    hub: "bangla",
    input: "text",
    related: ["number-to-bangla-words", "bangla-date-converter", "word-counter", "photo-signature-resizer"],
    aliases: ["sutonnymj to unicode", "বিজয় থেকে ইউনিকোড", "bijoy converter", "ansi to unicode"],
    built: false,
  },
  {
    slug: "bangla-date-converter",
    hub: "bangla",
    input: "text",
    related: ["age-calculator", "number-to-bangla-words", "bijoy-to-unicode", "word-counter"],
    aliases: ["bengali calendar", "বাংলা তারিখ", "bangla tarikh"],
    built: false,
  },
  {
    slug: "json-formatter",
    hub: "developer",
    input: "text",
    related: ["base64-encode-decode", "password-generator", "word-counter", "qr-code-generator"],
    aliases: ["json validator", "json beautifier", "pretty print json"],
    built: false,
  },
  {
    slug: "base64-encode-decode",
    hub: "developer",
    input: "text",
    related: ["json-formatter", "password-generator", "qr-code-generator", "word-counter"],
    aliases: ["base64 encoder", "base64 decoder"],
    built: false,
  },
  {
    slug: "password-generator",
    hub: "developer",
    input: "text",
    related: ["base64-encode-decode", "json-formatter", "qr-code-generator", "remove-image-metadata"],
    aliases: ["strong password", "random password", "পাসওয়ার্ড"],
    built: false,
  },
  {
    slug: "word-counter",
    hub: "text",
    input: "text",
    alsoIn: ["bangla"],
    related: ["bijoy-to-unicode", "number-to-bangla-words", "json-formatter", "age-calculator"],
    aliases: ["character counter", "letter count", "শব্দ গণনা", "bangla word count"],
    built: false,
  },
  {
    slug: "age-calculator",
    hub: "calculators",
    input: "text",
    related: ["bangla-date-converter", "word-counter", "number-to-bangla-words", "password-generator"],
    aliases: ["date difference", "date of birth calculator", "how old am i", "বয়স ক্যালকুলেটর", "boyosh"],
    built: false,
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
