import type { Tool } from "./tools";

// Original 24 by 24 icon artwork. Trusted constants, drawn in the current text color.

export const TOOL_ICONS: Record<string, string> = {
  "merge-pdf": '<path d="M4 5h5l5 7-5 7H4"/><path d="M14 12h6"/><path d="m17 9 3 3-3 3"/>',
  "split-pdf": '<path d="M20 5h-5l-5 7 5 7h5"/><path d="M10 12H4"/><path d="m17 2 3 3-3 3"/><path d="m17 16 3 3-3 3"/>',
  "compress-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m10 9 2.5 2.5L15 9"/><path d="m10 18 2.5-2.5L15 18"/>',
  "pdf-to-word": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m8.5 11 1.25 6.5L12 13l2.25 4.5L15.5 11"/>',
  "pdf-to-powerpoint": '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M12 17v3"/><path d="M8 20h8"/><path d="M9.5 14V8.5h2.25a1.75 1.75 0 0 1 0 3.5H9.5"/>',
  "jpg-to-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m9 18 3-4 2 2 1-1 1 3z"/>',
  "pdf-to-jpg": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5-9 10"/>',
  "pdf-to-png": '<rect x="3" y="4" width="18" height="16" rx="2" stroke-dasharray="3 2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5-9 10"/>',
  "scan-to-pdf": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/><path d="M8 8h8"/><path d="M8 16h5"/>',
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
  "grayscale-pdf": '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  "pdf-to-text": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 11h6"/><path d="M12 11v7"/>',
  "compare-pdf": '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/><path d="M5.5 9h3"/><path d="M15.5 9h3"/><path d="M5.5 13h3"/><path d="M15.5 13h3"/>',
  "fill-pdf-forms": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><rect x="8.5" y="10" width="8" height="3" rx="0.5"/><path d="m9 16.5 1.5 1.5 3-3"/>',
  "redact-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><rect x="8.5" y="10" width="8" height="3" fill="currentColor"/><path d="M8.5 16h5"/>',
  "edit-pdf": '<path d="M6 3h9l4 4v6"/><path d="M15 3v4h4"/><path d="M6 3v18h6"/><path d="m14.5 21 1-3.5 5-5 2.5 2.5-5 5z"/>',
  "ocr-pdf": '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8"/><path d="M8 12h8"/><path d="M8 15h5"/>',
};

export function iconFor(tool: Tool): string {
  return TOOL_ICONS[tool.slug] ?? TOOL_ICONS[tool.variantOf ?? ""];
}
