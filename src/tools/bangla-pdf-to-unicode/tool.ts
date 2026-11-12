import en from "../../i18n/en.json";
import type { ToolDefinition } from "../../lib/shell/types";
import { TEXT_CONFIG, textTool } from "../pdf-to-text/tool";
import { wordTool } from "../pdf-to-word/tool";

const t = en.banglaPdfToUnicode;
const config = { ...TEXT_CONFIG, acceptLabel: t.acceptLabel, arrangeHint: t.arrangeHint };
const asText = textTool(t.text, config);
const asWord = wordTool(t.word, config);

// PDF to text or PDF to Word, which both turn Bijoy text into Unicode as they read it, saying for each PDF whether it
// had any.
export const tool: ToolDefinition = {
  ...asText,
  run: (input, options, context) => (options.format === "word" ? asWord : asText).run(input, { markers: "no" }, context),
};
