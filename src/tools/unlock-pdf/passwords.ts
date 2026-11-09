// The passwords typed for each file, in the order of the file list.
export function readPasswords(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((item) => (typeof item === "string" ? item : "")) : [];
  } catch {
    return [];
  }
}
