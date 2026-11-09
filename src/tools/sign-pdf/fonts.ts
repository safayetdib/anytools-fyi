// Handwriting fonts for typed signatures: Satisfy is under the Apache License 2.0, the others the SIL Open Font License.
// Each is bundled with the site and only downloaded when shown.
import "@fontsource/dancing-script/400.css";
import "@fontsource/great-vibes/400.css";
import "@fontsource/satisfy/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/galada/400.css";

export const FONTS = [
  { key: "dancing", name: "Dancing Script", family: '"Dancing Script", cursive' },
  { key: "vibes", name: "Great Vibes", family: '"Great Vibes", cursive' },
  { key: "satisfy", name: "Satisfy", family: '"Satisfy", cursive' },
  { key: "caveat", name: "Caveat", family: '"Caveat", cursive' },
  // Writes Bangla as well as English letters.
  { key: "galada", name: "Galada", family: '"Galada", cursive', bangla: true },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];

export function fontOf(key: string) {
  return FONTS.find((font) => font.key === key) ?? FONTS[0];
}

// The date is plain print, like a typed form.
export const DATE_FAMILY = "Helvetica, Arial, sans-serif";
