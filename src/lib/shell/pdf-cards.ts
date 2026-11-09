import { previewPdfFile } from "../pdf/preview";

// Keeps a first-page picture, page count and status for each chosen PDF, for tools that show their files as cards.

export interface PdfCard {
  url: string | null;
  pages: number | null;
  status: "loading" | "ready" | "locked" | "unreadable";
}

export function trackPdfCards(shell: HTMLElement, width: number, onChange: (files: File[], cards: Map<File, PdfCard>) => void) {
  let files: File[] = [];
  const cards = new Map<File, PdfCard>();

  async function look(file: File) {
    const card = cards.get(file) as PdfCard;
    const preview = await previewPdfFile(file, width);
    if (!cards.has(file)) return;
    card.status = preview.status;
    if (preview.status === "ready" && preview.image) {
      card.url = URL.createObjectURL(preview.image);
      card.pages = preview.pageCount ?? null;
    }
    onChange(files, cards);
  }

  shell.addEventListener("anytools:files", (event) => {
    const next = (event as CustomEvent<{ files: File[] }>).detail.files;
    for (const [file, card] of cards) {
      if (next.includes(file)) continue;
      if (card.url) URL.revokeObjectURL(card.url);
      cards.delete(file);
    }
    const added = next.filter((file) => !cards.has(file));
    for (const file of added) cards.set(file, { url: null, pages: null, status: "loading" });
    files = next;
    onChange(files, cards);
    added.forEach((file) => void look(file));
  });
}

// A card with the file's first page, its name and a line about it.
export function cardElement(file: File, card: PdfCard, texts: { meta: string; unreadable: string }): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "pdf-card";
  const frame = document.createElement("span");
  frame.className = "pdf-card-frame";
  if (card.url) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = card.url;
    frame.append(img);
  } else if (card.status === "loading") frame.classList.add("is-loading");
  else if (card.status === "unreadable") frame.textContent = texts.unreadable;
  else {
    frame.classList.add("is-locked");
    frame.innerHTML =
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  }
  const name = document.createElement("span");
  name.className = "pdf-card-name";
  name.textContent = file.name;
  const meta = document.createElement("span");
  meta.className = "pdf-card-meta";
  meta.textContent = texts.meta;
  item.append(frame, name, meta);
  return item;
}
