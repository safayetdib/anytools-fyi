import type { Tool } from "./tools";

// Original 24 by 24 icon artwork. Trusted constants, drawn in the current text color.
const glyph = (text: string) =>
  `<text x="12" y="17.5" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" stroke="none">${text}</text>`;

export const TOOL_ICONS: Record<string, string> = {
  "merge-pdf": '<path d="M4 5h5l5 7-5 7H4"/><path d="M14 12h6"/><path d="m17 9 3 3-3 3"/>',
  "split-pdf": '<path d="M20 5h-5l-5 7 5 7h5"/><path d="M10 12H4"/><path d="m17 2 3 3-3 3"/><path d="m17 16 3 3-3 3"/>',
  "jpg-to-pdf": '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="m9 18 3-4 2 2 1-1 1 3z"/>',
  "pdf-to-jpg": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5-9 10"/>',
  "compress-image": '<path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M4 15h5v5"/><path d="M20 15h-5v5"/>',
  "number-to-bangla-words": glyph("১২"),
  "resize-image": '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/>',
  "photo-signature-resizer":
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 19c1-3 3-4 5-4s4 1 5 4"/>',
  "convert-image":
    '<path d="M4 10a8 8 0 0 1 14-4l2 2"/><path d="M20 4v4h-4"/><path d="M20 14a8 8 0 0 1-14 4l-2-2"/><path d="M4 20v-4h4"/>',
  "heic-to-jpg": '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/><path d="m10 9 2 2 2-2"/>',
  "remove-image-metadata":
    '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/><path d="m3 3 18 18"/>',
  "qr-code-generator":
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M21 14v.01"/><path d="M14 21h.01"/><path d="M17 21h4v-4"/>',
  "bijoy-to-unicode": glyph("অ"),
  "bangla-date-converter": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  "json-formatter":
    '<path d="M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1"/>',
  "base64-encode-decode": '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 4-4 16"/>',
  "password-generator": '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9"/><path d="m17 6 3 3"/><path d="m15 8 2 2"/>',
  "word-counter": '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>',
  "age-calculator":
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M8 16h.01"/><path d="M12 16h.01"/><path d="M16 16h.01"/>',
};

export function iconFor(tool: Tool): string {
  return TOOL_ICONS[tool.slug] ?? TOOL_ICONS[tool.variantOf ?? ""];
}
