// Downloads one of this site's own files, such as a language for the OCR reader, reporting how much has arrived when
// the server says how big it is. Tool code can't use the network, so visitors' files can't leave their device; this
// only reads, and only from this site.
export async function downloadSiteFile(path: string, onProgress: (fraction: number) => void = () => {}): Promise<Uint8Array> {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin) throw new Error(`Not one of this site's files: ${url.href}`);
  const response = await fetch(url, { method: "GET", credentials: "same-origin" });
  if (!response.ok || !response.body) throw new Error(`Couldn't load ${url.pathname}`);
  const total = Number(response.headers.get("content-length")) || 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(Math.min(received / total, 1));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
