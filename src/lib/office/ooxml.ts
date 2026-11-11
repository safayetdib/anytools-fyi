import { zipSync, type Zippable } from "fflate";

// Shared by the tools that save Word, PowerPoint and Excel files: these are ZIPs of XML parts.

// Text made safe inside XML. Characters XML can't hold at all, like most control characters, are dropped.
export function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// Points in the units Office files measure in.
export const twips = (points: number) => Math.round(points * 20);
export const emu = (points: number) => Math.round(points * 12700);

// The package: XML parts are compressed, pictures (already compressed) are only stored.
export function packOffice(parts: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const entries: Zippable = {};
  for (const [name, content] of Object.entries(parts)) {
    entries[name] = typeof content === "string" ? [encoder.encode(content), { level: 6 }] : [content, { level: 0 }];
  }
  return zipSync(entries);
}

// Bangla letters, which Office sets in the font for complex scripts.
export const BANGLA = /[ঀ-৿]/;
// The Bangla font that comes with Windows, used when the PDF's own font is for Latin letters only.
export const BANGLA_FONT = "Nirmala UI";
