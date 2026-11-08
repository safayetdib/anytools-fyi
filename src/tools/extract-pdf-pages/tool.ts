import en from "../../i18n/en.json";
import type { ToolDefinition } from "../../lib/shell/types";
import { tool as split } from "../split-pdf/tool";

// Like other PDF tools, extracting pages is Split PDF opened on its Pages tab, with its own page and wording.
export const tool: ToolDefinition = {
  ...split,
  config: split.config.mode === "files" ? { ...split.config, arrangeHint: en.extractPdfPages.arrangeHint } : split.config,
};
