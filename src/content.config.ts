import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { HELP_ICON_NAMES } from "./lib/help-icons";

const icon = z.enum(HELP_ICON_NAMES);
const card = z.object({ icon, title: z.string(), text: z.string() });

// Help text for each built tool. The body is the explainer, shown with the tool's diagram.
const tools = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/tools" }),
  schema: z.object({
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    howToTitle: z.string(),
    steps: z.array(card).min(3).max(5),
    // Each limit is a stat: a short headline value, what it measures, and an optional one-line note.
    limits: z
      .array(
        z.object({
          icon,
          value: z.string().max(14),
          label: z.string(),
          note: z.string().optional(),
          tone: z.enum(["default", "warn"]).default("default"),
        }),
      )
      .min(1),
    diagramTitle: z.string().optional(),
    tipsTitle: z.string().optional(),
    tips: z.array(card).max(4).default([]),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).min(4).max(6),
  }),
});

export const collections = { tools };
