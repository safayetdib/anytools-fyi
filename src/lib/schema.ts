import en from "../i18n/en.json";

const CONTEXT = "https://schema.org";

function absolute(path: string, site: URL) {
  return new URL(path, site).href;
}

export function websiteSchema(site: URL, description: string) {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: en.site.brand,
    alternateName: en.site.name,
    url: absolute("/", site),
    description,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: en.site.brand, url: absolute("/", site) },
  };
}

export function organizationSchema(site: URL) {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: en.site.brand,
    alternateName: en.site.name,
    url: absolute("/", site),
    logo: { "@type": "ImageObject", url: absolute("/icon-512.png", site), width: 512, height: 512 },
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

export function webApplicationSchema(
  tool: { name: string; description: string; path: string; image?: string; features?: string[]; updated?: string },
  site: URL,
) {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: tool.name,
    url: absolute(tool.path, site),
    description: tool.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript. Works in current versions of Chrome, Edge, Firefox and Safari.",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: en.site.brand, url: absolute("/", site) },
    ...(tool.image && { image: absolute(tool.image, site) }),
    ...(tool.features?.length && { featureList: tool.features }),
    ...(tool.updated && { dateModified: tool.updated }),
  };
}

export function howToSchema(name: string, steps: { title: string; text: string }[], site: URL, image?: string) {
  return {
    "@context": CONTEXT,
    "@type": "HowTo",
    name,
    totalTime: "PT1M",
    estimatedCost: { "@type": "MonetaryAmount", currency: "USD", value: "0" },
    ...(image && { image: absolute(image, site) }),
    step: steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.text,
    })),
  };
}

export function faqSchema(faq: { question: string; answer: string }[]) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}
