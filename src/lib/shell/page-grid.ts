import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import type { OutputPreview } from "./types";

const g = en.pageGrid;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 240;
const ZOOM =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const TICK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

export interface GridRange {
  from: number;
  to: number;
}

interface PageGridOptions {
  list: HTMLOListElement;
  status: HTMLElement;
  open(blob: Blob): Promise<OutputPreview>;
  // Called when someone taps a page in a selectable view.
  onToggle?(page: number): void;
  // Called from a page's zoom button, to show that page larger.
  onZoom?(page: number, from: HTMLElement): void;
}

// The pages of one file, shown either as ranges (first page … last page in a dashed box)
// or as every page with a tick. Thumbnails render only as they scroll into view, and are kept for reuse.
export function createPageGrid({ list, status, open, onToggle, onZoom }: PageGridOptions) {
  let preview: OutputPreview | null = null;
  let observer: IntersectionObserver | null = null;
  let token = 0;
  let pageCount = 0;
  let fileName = "";
  const thumbnails = new Map<number, string>();
  const waiting: HTMLElement[] = [];
  let drawing = false;

  function say(message: string) {
    status.textContent = message;
    status.hidden = !message;
  }

  function clear() {
    token++;
    observer?.disconnect();
    observer = null;
    preview?.close();
    preview = null;
    thumbnails.forEach((url) => URL.revokeObjectURL(url));
    thumbnails.clear();
    waiting.length = 0;
    pageCount = 0;
    list.replaceChildren();
    list.removeAttribute("data-view");
    say("");
  }

  function paint(frame: HTMLElement, url: string) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    frame.replaceChildren(img);
  }

  async function drawQueue(run: number) {
    if (drawing) return;
    drawing = true;
    while (waiting.length && run === token && preview) {
      const frame = waiting.shift() as HTMLElement;
      const page = Number(frame.dataset.thumb);
      if (!frame.isConnected || frame.querySelector("img")) continue;
      let url = thumbnails.get(page);
      if (!url) {
        try {
          const { blob } = await preview.renderPage(page, THUMBNAIL_WIDTH);
          if (run !== token) break;
          url = URL.createObjectURL(blob);
          thumbnails.set(page, url);
        } catch {
          // A page that can't be drawn keeps its blank frame.
          continue;
        }
      }
      paint(frame, url);
    }
    drawing = false;
  }

  // Frames whose picture is already made are filled at once; the rest wait until they scroll into view.
  function watch() {
    observer?.disconnect();
    const run = token;
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          waiting.push(entry.target as HTMLElement);
          observer?.unobserve(entry.target);
        }
        void drawQueue(run);
      },
      { rootMargin: "400px 0px" },
    );
    list.querySelectorAll<HTMLElement>("[data-thumb]").forEach((frame) => {
      const ready = thumbnails.get(Number(frame.dataset.thumb));
      if (ready) paint(frame, ready);
      else observer?.observe(frame);
    });
  }

  function zoomButton(page: number): HTMLButtonElement | null {
    if (!onZoom) return null;
    const zoom = document.createElement("button");
    zoom.type = "button";
    zoom.className = "page-grid-zoom";
    zoom.dataset.zoom = String(page);
    zoom.setAttribute("aria-label", fill(g.zoom, { page }));
    zoom.innerHTML = ZOOM;
    return zoom;
  }

  function pageCard(page: number): HTMLElement {
    const card = document.createElement("span");
    card.className = "page-grid-card";
    const frame = document.createElement("span");
    frame.className = "page-grid-frame";
    frame.dataset.thumb = String(page);
    const caption = document.createElement("span");
    caption.className = "page-grid-caption";
    caption.textContent = String(page);
    card.append(frame, caption);
    return card;
  }

  list.addEventListener("click", (event) => {
    const zoom = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-zoom]");
    if (zoom) {
      onZoom?.(Number(zoom.dataset.zoom), zoom);
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (button && onToggle) onToggle(Number(button.dataset.page));
  });

  return {
    // Opens a file and returns how many pages it has, or null when it can't be read.
    async load(file: File | null): Promise<number | null> {
      clear();
      if (!file) return null;
      const run = token;
      fileName = file.name;
      say(g.loading);
      try {
        const opened = await open(file);
        if (run !== token) {
          opened.close();
          return null;
        }
        preview = opened;
        pageCount = opened.pageCount;
        say("");
        return pageCount;
      } catch {
        if (run === token) say(g.failed);
        return null;
      }
    },

    // Each range as a dashed box: its first page, and for longer ranges "…" and its last page.
    showRanges(ranges: GridRange[]) {
      if (!pageCount) return;
      list.dataset.view = "ranges";
      list.setAttribute("aria-label", fill(g.rangesLabel, { name: fileName }));
      list.replaceChildren(
        ...ranges.map((range, index) => {
          const item = document.createElement("li");
          item.className = "page-grid-range";
          item.setAttribute("data-testid", "page-grid-range");
          const title = document.createElement("span");
          title.className = "page-grid-range-title";
          title.setAttribute("aria-hidden", "true");
          title.textContent = fill(g.rangeTitle, { number: index + 1 });
          const label = document.createElement("span");
          label.className = "sr-only";
          label.textContent =
            range.from === range.to
              ? fill(g.rangeSummaryOne, { number: index + 1, page: range.from })
              : fill(g.rangeSummary, { number: index + 1, from: range.from, to: range.to });
          const box = document.createElement("span");
          box.className = "page-grid-range-box";
          box.setAttribute("aria-hidden", "true");
          box.append(pageCard(range.from));
          if (range.to > range.from) {
            const more = document.createElement("span");
            more.className = "page-grid-more";
            more.textContent = "…";
            box.append(more, pageCard(range.to));
          }
          item.append(title, label, box);
          return item;
        }),
      );
      watch();
    },

    // Every page, with a tick on the chosen ones. When selectable, each page is a toggle button.
    showPages(selected: Set<number>, selectable: boolean) {
      if (!pageCount) return;
      list.dataset.view = "pages";
      list.setAttribute("aria-label", fill(g.label, { name: fileName }));
      const items = Array.from({ length: pageCount }, (_, index) => {
        const page = index + 1;
        const item = document.createElement("li");
        item.className = "page-grid-item";
        item.setAttribute("data-testid", "page-grid-item");
        const holder = document.createElement(selectable ? "button" : "span");
        holder.className = "page-grid-page";
        holder.dataset.page = String(page);
        if (holder instanceof HTMLButtonElement) {
          holder.type = "button";
          holder.setAttribute("aria-pressed", String(selected.has(page)));
          holder.setAttribute("aria-label", fill(g.selectPage, { page }));
        } else {
          holder.setAttribute("aria-label", fill(g.page, { page }));
          holder.setAttribute("role", "img");
        }
        const tick = document.createElement("span");
        tick.className = "page-grid-tick";
        tick.setAttribute("aria-hidden", "true");
        tick.innerHTML = TICK;
        tick.hidden = !selected.has(page);
        holder.append(tick, pageCard(page));
        item.append(holder);
        const zoom = zoomButton(page);
        if (zoom) item.append(zoom);
        return item;
      });
      list.replaceChildren(...items);
      watch();
    },

    // Updates ticks in place, so tapping a page doesn't redraw the grid.
    setSelected(selected: Set<number>) {
      list.querySelectorAll<HTMLElement>("[data-page]").forEach((holder) => {
        const on = selected.has(Number(holder.dataset.page));
        if (holder instanceof HTMLButtonElement) holder.setAttribute("aria-pressed", String(on));
        (holder.querySelector(".page-grid-tick") as HTMLElement).hidden = !on;
      });
    },

    // The file as one card: its first page and its name, for choices that don't depend on pages.
    showFirst() {
      this.showRanges(pageCount ? [{ from: 1, to: 1 }] : []);
      list.dataset.view = "first";
      list.querySelector(".page-grid-range-title")?.remove();
      const label = list.querySelector(".sr-only");
      if (label) label.textContent = fileName;
      const caption = list.querySelector(".page-grid-caption");
      if (caption) caption.textContent = fileName;
    },

    // Outlines the range being edited, so its box is easy to find.
    setActiveRange(index: number | null) {
      list.querySelectorAll<HTMLElement>(".page-grid-range").forEach((item, position) => item.toggleAttribute("data-active", position === index));
    },

    get pageCount() {
      return pageCount;
    },

    clear,
  };
}
