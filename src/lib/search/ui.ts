import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { createSearch, type SearchEntry } from "./search";

const t = en.search;
let searchReady: Promise<(query: string) => SearchEntry[]> | undefined;

function loadSearch() {
  searchReady ??= fetch("/search-index.json")
    .then((response) => response.json() as Promise<SearchEntry[]>)
    .then((entries) => createSearch(entries))
    .catch((error) => {
      searchReady = undefined;
      throw error;
    });
  return searchReady;
}

function initSearchBox(form: HTMLFormElement) {
  const input = form.querySelector("input") as HTMLInputElement;
  const popup = form.querySelector<HTMLElement>("[data-popup]") as HTMLElement;
  const list = form.querySelector<HTMLUListElement>('[role="listbox"]') as HTMLUListElement;
  const empty = form.querySelector<HTMLElement>("[data-empty]") as HTMLElement;
  const status = form.querySelector<HTMLElement>("[data-status]") as HTMLElement;
  let results: SearchEntry[] = [];
  let active = -1;
  let lastQuery = "";

  function close() {
    popup.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function setActive(index: number) {
    active = index;
    list.querySelectorAll<HTMLElement>('[role="option"]').forEach((option, i) => {
      option.setAttribute("aria-selected", String(i === index));
      if (i === index) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
    if (index < 0) input.removeAttribute("aria-activedescendant");
  }

  function go(entry: SearchEntry | undefined) {
    if (entry) window.location.href = `/${entry.slug}/`;
  }

  function render(query: string) {
    list.replaceChildren(
      ...results.map((entry, index) => {
        const option = document.createElement("li");
        option.id = `${input.id}-option-${index}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.className = "search-option";
        const name = document.createElement("span");
        name.className = "search-name";
        name.textContent = entry.name;
        const meta = document.createElement("span");
        meta.className = "search-meta";
        meta.textContent = `${entry.category} · ${entry.description}`;
        option.append(name, meta);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => go(entry));
        return option;
      }),
    );
    empty.hidden = results.length > 0;
    empty.textContent = results.length ? "" : fill(t.none, { query });
    status.textContent = results.length === 0 ? empty.textContent : results.length === 1 ? t.one : fill(t.many, { count: results.length });
    popup.hidden = false;
    input.setAttribute("aria-expanded", String(results.length > 0));
    setActive(-1);
  }

  async function update() {
    const query = input.value.trim();
    lastQuery = query;
    if (!query) {
      results = [];
      status.textContent = "";
      return close();
    }
    const search = await loadSearch();
    if (query !== lastQuery) return;
    results = search(query);
    render(query);
  }

  input.addEventListener("focus", () => {
    void loadSearch().catch(() => {});
    if (input.value.trim()) void update();
  });
  input.addEventListener("input", () => void update());
  input.addEventListener("keydown", (event) => {
    const open = !popup.hidden && results.length > 0;
    if (event.key === "ArrowDown" && open) {
      event.preventDefault();
      setActive((active + 1) % results.length);
    } else if (event.key === "ArrowUp" && open) {
      event.preventDefault();
      setActive(active <= 0 ? results.length - 1 : active - 1);
    } else if (event.key === "Escape" && !popup.hidden) {
      // The first Escape only closes the list. The browser clears the text on the next one.
      event.preventDefault();
      close();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    await update();
    go(results[Math.max(active, 0)]);
  });
  form.addEventListener("focusout", (event) => {
    if (!form.contains(event.relatedTarget as Node | null)) close();
  });
}

function focusFirstVisibleSearch() {
  const header = document.querySelector<HTMLElement>("[data-search-toggle]");
  if (header && getComputedStyle(header).display !== "none") header.click();
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-search] input"));
  inputs.find((input) => input.offsetParent !== null)?.focus();
}

export function initSearch() {
  document.querySelectorAll<HTMLFormElement>("[data-search]").forEach(initSearchBox);

  const toggle = document.querySelector<HTMLButtonElement>("[data-search-toggle]");
  const header = document.querySelector<HTMLElement>(".header");
  if (toggle && header) {
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const open = header.toggleAttribute("data-search-open");
      toggle.setAttribute("aria-expanded", String(open));
      if (open) header.querySelector<HTMLInputElement>("[data-search] input")?.focus();
    });
  }

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    focusFirstVisibleSearch();
  });
}
