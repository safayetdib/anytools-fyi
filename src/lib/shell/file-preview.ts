import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import type { OutputPreview, ToolDefinition } from "./types";

const t = en.shell;
const SWIPE_DISTANCE = 60;

function el<T extends HTMLElement>(root: HTMLElement, name: string): T {
  return root.querySelector(`[data-el="${name}"]`) as T;
}

// A read-only look at one chosen file, page by page, before it's merged.
export function createFilePreview(root: HTMLElement, tool: ToolDefinition) {
  const dialog = root.querySelector<HTMLDialogElement>('[data-el="file-viewer"]');
  const openOutput = tool.previewOutput;
  if (!dialog || !openOutput) return null;

  const name = el(dialog, "fv-name");
  const pageLabel = el(dialog, "fv-page");
  const status = el(dialog, "fv-status");
  const scroll = el(dialog, "fv-scroll");
  const image = el<HTMLImageElement>(dialog, "fv-image");
  const prev = el<HTMLButtonElement>(dialog, "fv-prev");
  const next = el<HTMLButtonElement>(dialog, "fv-next");

  let preview: OutputPreview | null = null;
  let index = 0;
  let token = 0;
  let opener: HTMLElement | null = null;

  function setStatus(message: string) {
    status.textContent = message;
    status.hidden = !message;
  }

  function clearImage() {
    if (image.src) URL.revokeObjectURL(image.src);
    image.removeAttribute("src");
  }

  async function show(target: number) {
    const current = preview;
    if (!current) return;
    index = Math.min(Math.max(target, 0), current.pageCount - 1);
    pageLabel.textContent = fill(t.pageOf, { page: index + 1, total: current.pageCount });
    prev.disabled = index === 0;
    next.disabled = index === current.pageCount - 1;
    // A disabled button drops focus, so hand it to the arrow that still works.
    if (prev.disabled && document.activeElement === prev) next.focus();
    if (next.disabled && document.activeElement === next) prev.focus();
    const run = ++token;
    const width = Math.round(Math.max(scroll.clientWidth - 32, 200) * Math.min(window.devicePixelRatio || 1, 2));
    try {
      const page = await current.renderPage(index + 1, width);
      if (run !== token) return;
      clearImage();
      image.src = URL.createObjectURL(page.blob);
      setStatus("");
    } catch {
      if (run === token) setStatus(t.previewFailed);
    }
  }

  async function open(file: File, from: HTMLElement, startPage = 1) {
    opener = from;
    const run = ++token;
    name.textContent = file.name;
    pageLabel.textContent = "";
    clearImage();
    setStatus(t.previewLoading);
    prev.disabled = true;
    next.disabled = true;
    dialog?.showModal();
    try {
      const opened = await openOutput?.(file);
      if (!opened) return;
      if (run !== token) return opened.close();
      preview = opened;
      await show(startPage - 1);
    } catch {
      if (run === token) setStatus(t.previewFailed);
    }
  }

  prev.addEventListener("click", () => void show(index - 1));
  next.addEventListener("click", () => void show(index + 1));
  el(dialog, "fv-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" && !prev.disabled) void show(index - 1);
    if (event.key === "ArrowRight" && !next.disabled) void show(index + 1);
  });

  // On a touch screen, a sideways swipe turns the page.
  let swipe: { x: number; y: number } | null = null;
  scroll.addEventListener("pointerdown", (event) => {
    swipe = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
  });
  scroll.addEventListener("pointerup", (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && !next.disabled) void show(index + 1);
    if (dx > 0 && !prev.disabled) void show(index - 1);
  });
  scroll.addEventListener("pointercancel", () => (swipe = null));

  dialog.addEventListener("close", () => {
    token++;
    preview?.close();
    preview = null;
    clearImage();
    opener?.focus();
  });

  return { open };
}
