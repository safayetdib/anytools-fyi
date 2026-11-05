import en from "../i18n/en.json";

const CONTEXT = "https://schema.org";

function absolute(path: string, site: URL) {
  return new URL(path, site).href;
}

export function websiteSchema(site: URL, description: string) {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: en.site.name,
    url: absolute("/", site),
    description,
    inLanguage: "en",
  };
}

export function organizationSchema(site: URL) {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: en.site.name,
    url: absolute("/", site),
    logo: absolute("/favicon.svg", site),
  };
}

export function breadcrumbSchema(items: { name: string; path: string }[], site: URL) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.path, site),
    })),
  };
}

export function collectionSchema(
  page: { name: string; description: string; path: string },
  tools: { name: string; path: string }[],
  site: URL,
) {
  return {
    "@context": CONTEXT,
    "@type": "CollectionPage",
    name: page.name,
    description: page.description,
    url: absolute(page.path, site),
    inLanguage: "en",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: tools.map((tool, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: tool.name,
        url: absolute(tool.path, site),
      })),
    },
  };
}

export function webApplicationSchema(tool: { name: string; description: string; path: string }, site: URL) {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: tool.name,
    url: absolute(tool.path, site),
    description: tool.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    inLanguage: "en",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
}
