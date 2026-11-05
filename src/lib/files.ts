const UNITS = ["B", "KB", "MB", "GB"];

export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[unit]}`;
}

export function matchesAccept(file: File, accept: string | undefined): boolean {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .some((token) => {
      if (token.startsWith(".")) return name.endsWith(token);
      if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
      return type === token;
    });
}

export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .replace(/[<>:"|?*\u0000-\u001f]+/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned || "download";
}
