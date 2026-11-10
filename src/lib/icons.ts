import type { Tool } from "./tools";

// Original 24 by 24 icon artwork. Trusted constants, drawn in the current text color.

export const TOOL_ICONS: Record<string, string> = {
  "merge-pdf": '<path d="M4 5h5l5 7-5 7H4"/><path d="M14 12h6"/><path d="m17 9 3 3-3 3"/>',
  "split-pdf": '<path d="M20 5h-5l-5 7 5 7h5"/><path d="M10 12H4"/><path d="m17 2 3 3-3 3"/><path d="m17 16 3 3-3 3"/>',
  "compress-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m10 9 2.5 2.5L15 9"/><path d="m10 18 2.5-2.5L15 18"/>',
  "jpg-to-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m9 18 3-4 2 2 1-1 1 3z"/>',
  "pdf-to-jpg": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5-9 10"/>',
  "sign-pdf": '<path d="M3 17c3-6 5-9 6-8s-2 8 0 8 3-6 5-6-1 5 1 5 3-3 6-4"/><path d="M3 21h18"/>',
  "organize-pdf":
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><path d="M14 6h4a2 2 0 0 1 2 2v1"/><path d="m18 7 2 2 2-2"/><path d="M10 18H6a2 2 0 0 1-2-2v-1"/><path d="m6 17-2-2-2 2"/>',
  "rotate-pdf": '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><rect x="9" y="9" width="6" height="7" rx="1"/>',
  "crop-pdf": '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  "remove-pdf-pages":
    '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m10 12 5 5"/><path d="m15 12-5 5"/>',
  "extract-pdf-pages":
    '<path d="M6 3h9l4 4v8"/><path d="M15 3v4h4"/><path d="M6 3v18h6"/><path d="M15 21h6"/><path d="m18 18 3 3-3 3"/>',
  "add-page-numbers": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M11 13l1.5-1V18"/><path d="M10.5 18h4"/>',
  "add-watermark": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M8.5 17 15.5 11"/><path d="M9 12.5h3"/>',
  "protect-pdf": '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/>',
  "unlock-pdf": '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/><path d="M12 15v2"/>',
  "repair-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M14.5 10.5a2.5 2.5 0 0 0-3.4 3.2l-2.6 2.6 1.2 1.2 2.6-2.6a2.5 2.5 0 0 0 3.2-3.4l-1.4 1.4-1.2-1.2z"/>',
};

export function iconFor(tool: Tool): string {
  return TOOL_ICONS[tool.slug] ?? TOOL_ICONS[tool.variantOf ?? ""];
}
