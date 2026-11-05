export type HubId = "pdf" | "image" | "bangla" | "developer" | "text" | "calculators";

export interface Hub {
  id: HubId;
  slug: string;
  color: string;
}

export interface Tool {
  slug: string;
  hub: HubId;
  alsoIn?: HubId[];
  related: string[];
  aliases: string[];
  live: boolean;
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
    related: ["split-pdf", "jpg-to-pdf", "pdf-to-jpg", "compress-image"],
    aliases: ["combine pdf", "join pdf", "pdf merger", "পিডিএফ যুক্ত করুন", "pdf jukto"],
    live: true,
  },
  {
    slug: "compress-image",
    hub: "image",
    related: ["compress-image-to-20kb", "resize-image", "convert-image", "jpg-to-pdf"],
    aliases: ["reduce image size", "shrink photo", "ছবির সাইজ কমান", "chobir size komano"],
    live: true,
  },
  {
    slug: "split-pdf",
    hub: "pdf",
    related: ["merge-pdf", "pdf-to-jpg", "jpg-to-pdf", "compress-image"],
    aliases: ["extract pdf pages", "separate pdf", "পিডিএফ ভাগ করুন"],
    live: true,
  },
  {
    slug: "jpg-to-pdf",
    hub: "pdf",
    related: ["pdf-to-jpg", "merge-pdf", "compress-image", "heic-to-jpg"],
    aliases: ["images to pdf", "png to pdf", "photo to pdf", "ছবি থেকে পিডিএফ"],
    live: true,
  },
  {
    slug: "pdf-to-jpg",
    hub: "pdf",
    related: ["jpg-to-pdf", "split-pdf", "merge-pdf", "compress-image"],
    aliases: ["pdf to image", "pdf to png", "পিডিএফ থেকে ছবি"],
    live: true,
  },
  {
    slug: "number-to-bangla-words",
    hub: "bangla",
    related: ["bijoy-to-unicode", "bangla-date-converter", "word-counter", "age-calculator"],
    aliases: ["amount in words bangla", "সংখ্যা থেকে কথায়", "taka in words", "shongkha kothay"],
    live: true,
  },
  {
    slug: "resize-image",
    hub: "image",
    related: ["compress-image", "convert-image", "photo-signature-resizer", "remove-image-metadata"],
    aliases: ["change image dimensions", "scale photo", "ছবি রিসাইজ"],
    live: false,
  },
  {
    slug: "compress-image-to-20kb",
    hub: "image",
    related: ["compress-image-to-50kb", "compress-image-to-100kb", "compress-image", "photo-signature-resizer"],
    aliases: ["20 kb photo", "ছবি ২০ কেবি"],
    live: false,
    variantOf: "compress-image",
  },
  {
    slug: "compress-image-to-50kb",
    hub: "image",
    related: ["compress-image-to-20kb", "compress-image-to-100kb", "compress-image", "photo-signature-resizer"],
    aliases: ["50 kb photo", "ছবি ৫০ কেবি"],
    live: false,
    variantOf: "compress-image",
  },
  {
    slug: "compress-image-to-100kb",
    hub: "image",
    related: ["compress-image-to-20kb", "compress-image-to-50kb", "compress-image", "photo-signature-resizer"],
    aliases: ["100 kb photo", "ছবি ১০০ কেবি"],
    live: false,
    variantOf: "compress-image",
  },
  {
    slug: "photo-signature-resizer",
    hub: "image",
    alsoIn: ["bangla"],
    related: ["compress-image-to-20kb", "resize-image", "compress-image", "jpg-to-pdf"],
    aliases: ["job application photo", "form photo size", "ছবি ও স্বাক্ষর", "teletalk photo"],
    live: false,
  },
  {
    slug: "convert-image",
    hub: "image",
    related: ["heic-to-jpg", "compress-image", "resize-image", "jpg-to-pdf"],
    aliases: ["png to jpg", "jpg to png", "webp to jpg", "image converter"],
    live: false,
  },
  {
    slug: "heic-to-jpg",
    hub: "image",
    related: ["convert-image", "compress-image", "jpg-to-pdf", "remove-image-metadata"],
    aliases: ["iphone photo to jpg", "heif to jpg"],
    live: false,
  },
  {
    slug: "remove-image-metadata",
    hub: "image",
    related: ["compress-image", "resize-image", "convert-image", "heic-to-jpg"],
    aliases: ["remove exif", "strip photo location", "exif remover"],
    live: false,
  },
  {
    slug: "qr-code-generator",
    hub: "image",
    related: ["password-generator", "base64-encode-decode", "convert-image", "word-counter"],
    aliases: ["make qr code", "qr maker", "কিউআর কোড"],
    live: false,
  },
  {
    slug: "bijoy-to-unicode",
    hub: "bangla",
    related: ["number-to-bangla-words", "bangla-date-converter", "word-counter", "photo-signature-resizer"],
    aliases: ["sutonnymj to unicode", "বিজয় থেকে ইউনিকোড", "bijoy converter", "ansi to unicode"],
    live: false,
  },
  {
    slug: "bangla-date-converter",
    hub: "bangla",
    related: ["age-calculator", "number-to-bangla-words", "bijoy-to-unicode", "word-counter"],
    aliases: ["bengali calendar", "বাংলা তারিখ", "bangla tarikh"],
    live: false,
  },
  {
    slug: "json-formatter",
    hub: "developer",
    related: ["base64-encode-decode", "password-generator", "word-counter", "qr-code-generator"],
    aliases: ["json validator", "json beautifier", "pretty print json"],
    live: false,
  },
  {
    slug: "base64-encode-decode",
    hub: "developer",
    related: ["json-formatter", "password-generator", "qr-code-generator", "word-counter"],
    aliases: ["base64 encoder", "base64 decoder"],
    live: false,
  },
  {
    slug: "password-generator",
    hub: "developer",
    related: ["base64-encode-decode", "json-formatter", "qr-code-generator", "remove-image-metadata"],
    aliases: ["strong password", "random password", "পাসওয়ার্ড"],
    live: false,
  },
  {
    slug: "word-counter",
    hub: "text",
    alsoIn: ["bangla"],
    related: ["bijoy-to-unicode", "number-to-bangla-words", "json-formatter", "age-calculator"],
    aliases: ["character counter", "letter count", "শব্দ গণনা", "bangla word count"],
    live: false,
  },
  {
    slug: "age-calculator",
    hub: "calculators",
    related: ["bangla-date-converter", "word-counter", "number-to-bangla-words", "password-generator"],
    aliases: ["date difference", "date of birth calculator", "বয়স ক্যালকুলেটর", "boyosh"],
    live: false,
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
  }
}

validateRegistry(TOOLS);

export function listedTools(tools: Tool[] = TOOLS): Tool[] {
  return tools.filter((tool) => tool.live && !tool.variantOf);
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
