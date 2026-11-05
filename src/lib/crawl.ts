import { getEntry } from "astro:content";
import en from "../i18n/en.json";
import { hubMeta, indexableHubs, indexableTools, toolMeta, type SitemapEntry } from "./seo";
import type { Tool } from "./tools";

interface InfoPage {
  path: string;
  title: string;
  description: string;
  updated: string;
}

const tools = en.tools as Record<string, { name: string; description: string }>;

// The info pages are Markdown files beside the routes. Their front matter carries the title, description and date.
// Drafts stay out of search until they're final.
export function infoPages(): InfoPage[] {
  const modules = import.meta.glob<{ frontmatter: { title: string; description: string; updated: string; draft?: boolean } }>(
    "../pages/*.md",
    { eager: true },
  );
  return Object.entries(modules)
    .filter(([, module]) => !module.frontmatter.draft)
    .map(([file, module]) => ({
      path: `/${/([^/]+)\.md$/.exec(file)?.[1]}/`,
      ...module.frontmatter,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function toolUpdated(tool: Tool) {
  return (await getEntry("tools", tool.slug))?.data.updated;
}

export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const built = await Promise.all(
    indexableTools().map(async (tool) => ({ path: `/${tool.slug}/`, lastmod: await toolUpdated(tool) })),
  );
  const info = infoPages().map(({ path, updated }) => ({ path, lastmod: updated }));
  const latest = [...built, ...info].map((entry) => entry.lastmod ?? "").sort().at(-1);
  return [
    { path: "/", lastmod: latest },
    { path: "/tools/", lastmod: latest },
    ...indexableHubs().map((hub) => ({ path: `/${hub.slug}/`, lastmod: latest })),
    ...built,
    ...info,
  ];
}

const link = (site: URL, path: string, name: string, description: string) =>
  `- [${name}](${new URL(path, site).href}): ${description}`;

/** A plain-text map of the site for AI search, following llmstxt.org. */
export function llmsTxt(site: URL): string {
  return [
    `# ${en.site.name}`,
    "",
    `> ${en.site.tagline}`,
    "",
    "AnyTools (anytools.fyi) is a free website of everyday tools that work on any phone or computer, with no signup and no watermarks. Each tool's page says whether it works entirely in the browser; those tools never upload files. More tools are being added.",
    "",
    "## Tools",
    "",
    ...indexableTools().map((tool) => link(site, `/${tool.slug}/`, tools[tool.slug].name, toolMeta(tool).description)),
    "",
    "## Categories",
    "",
    link(site, "/tools/", en.allTools.heading, en.allTools.description),
    ...indexableHubs().map((hub) => link(site, `/${hub.slug}/`, en.hubs[hub.id].name, hubMeta(hub).description)),
    "",
    "## About",
    "",
    ...infoPages().map((page) => link(site, page.path, page.title, page.description)),
    "",
    "## Optional",
    "",
    link(site, "/llms-full.txt", "Full tool guides", "Steps, limits, tips and answers to common questions for every tool."),
    "",
  ].join("\n");
}

/** Every working tool's full guide in one file, so AI answers can quote it accurately. */
export async function llmsFullTxt(site: URL): Promise<string> {
  const sections = await Promise.all(
    indexableTools().map(async (tool) => {
      const help = await getEntry("tools", tool.slug);
      const strings = tools[tool.slug];
      const lines = [`## ${strings.name}`, "", `URL: ${new URL(`/${tool.slug}/`, site).href}`, "", toolMeta(tool).description, ""];
      if (!help) return lines.join("\n");
      const { data, body } = help;
      lines.push(
        `### ${data.howToTitle}`,
        "",
        ...data.steps.map((step, i) => `${i + 1}. ${step.title}: ${step.text}`),
        "",
        "### Limits",
        "",
        ...data.limits.map((limit) => `- ${limit.label}: ${limit.value}${limit.note ? `. ${limit.note}` : ""}`),
        "",
      );
      if (body?.trim()) lines.push(`### ${data.diagramTitle ?? "How it works"}`, "", body.trim(), "");
      if (data.tips.length) {
        lines.push(`### ${data.tipsTitle ?? "Tips"}`, "", ...data.tips.map((tip) => `- ${tip.title}: ${tip.text}`), "");
      }
      lines.push("### Questions", "", ...data.faq.flatMap((item) => [`**${item.question}**`, "", item.answer, ""]));
      lines.push(`Last updated: ${data.updated}`, "");
      return lines.join("\n");
    }),
  );
  return [`# ${en.site.name}: full tool guides`, "", `> ${en.site.tagline}`, "", ...sections].join("\n");
}
