import { zipSync } from "fflate";

// PDFs and Office files are already compressed, so the ZIP only stores them: faster, and no bigger.
export function zipParts(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const { name, bytes } of files) {
    let unique = name;
    for (let copy = 2; unique in entries; copy++) unique = name.replace(/(\.[a-z0-9]+)?$/i, ` (${copy})$1`);
    entries[unique] = [bytes, { level: 0 }];
  }
  return zipSync(entries);
}
