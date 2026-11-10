// Damages a PDF the way an interrupted download or a bad editor does: the pointer to its table of where objects start,
// and every entry in that table, are shifted, so readers that trust them fail. The objects themselves are intact, so
// the file can be repaired.
export function damage(bytes: Uint8Array): Uint8Array {
  // One character per byte, so binary streams survive the round trip.
  const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  const shift = (offset: string) => String(Number(offset) + 7);
  const broken = text
    .replace(/^(\d{10}) (\d{5}) n/gm, (_, offset: string, generation: string) => `${shift(offset).padStart(10, "0")} ${generation} n`)
    .replace(/startxref\s+(\d+)/, (_, offset: string) => `startxref\n${shift(offset)}`);
  if (broken === text) throw new Error("Nothing to damage");
  return Uint8Array.from(broken, (char) => char.charCodeAt(0));
}
