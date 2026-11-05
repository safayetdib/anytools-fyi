import type { ToolDefinition } from "../../lib/shell/types";

// A stand-in text tool for testing the shell. It is never built for production.
export const tool: ToolDefinition = {
  config: { mode: "text", inputLabel: "Text to change" },
  async run({ text }) {
    return { text: text.toUpperCase(), summary: "Done. Your text is ready." };
  },
};
