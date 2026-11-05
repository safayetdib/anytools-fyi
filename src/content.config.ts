import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Help text for each built tool. The body is the explainer, shown below the steps.
const tools = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/tools" }),
  schema: z.object({
    updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    howToTitle: z.string(),
    steps: z.array(z.string()).min(3).max(5),
    limits: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).min(4).max(6),
  }),
});

export const collections = { tools };
