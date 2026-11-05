import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize, safeFileName } from "../files";
import { createToolController, totalPages, type QueuedFile, type ShellState } from "./controller";
import type { OutputPreview, ToolDefinition } from "./types";

const t = en.shell;
const PREVIEW_BATCH = 12;
const PAGE_THUMBNAIL_WIDTH = 288;

function el<T extends HTMLElement>(root: HTMLElement, name: string): T {
  return root.querySelector(`[data-el="${name}"]`) as T;
}

function button(label: string, glyph: string, attrs: Record<string, string>) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "shell-icon-button";
  node.setAttribute("aria-label", label);
  for (const [key, value] of Object.entries(attrs)) node.dataset[key] = value;
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = glyph;
  node.append(icon);
  return node;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : fill(many, { count }));

function fileMeta({ file, preview }: QueuedFile): { text: string; problem: boolean } {
  const size = formatSize(file.size);
  if (preview?.status === "locked") return { text: `${size} · ${t.locked}`, problem: true };
  if (preview?.status === "unreadable") return { text: `${size} · ${t.unreadablePreview}`, problem: true };
  if (preview?.pageCount !== undefined) {
    return { text: `${size} · ${plural(preview.pageCount, t.pageOne, t.pageMany)}`, problem: false };
  }
  return { text: size, problem: false };
}

export function mountToolShell(root: HTMLElement, tool: ToolDefinition) {
  const controller = createToolController(tool);
  const { state } = controller;
  const isText = tool.config.mode === "text";
  const hasFilePreviews = Boolean(tool.previewFile);

  const live = el(root, "live");
  const error = el(root, "error");
  const warning = el(root, "warning");
  const zone = root.querySelector<HTMLElement>('[data-el="zone"]');
  const pickInput = root.querySelector<HTMLInputElement>('[data-el="pick-input"]');
  const addInput = root.querySelector<HTMLInputElement>('[data-el="add-input"]');
  const form = el<HTMLFormElement>(root, "form");
  const list = root.querySelector<HTMLOListElement>('[data-el="list"]');
  const total = root.querySelector<HTMLElement>('[data-el="total"]');
  const textInput = root.querySelector<HTMLTextAreaElement>('[data-el="text"]');
  const runButton = el<HTMLButtonElement>(root, "run");
  const progress = el<HTMLProgressElement>(root, "progress");
  const status = el(root, "status");
  const resultHeading = el(root, "result-heading");
  const summary = el(root, "summary");
  const downloads = el<HTMLUListElement>(root, "downloads");
  const output = el(root, "output");
  const copyButton = el<HTMLButtonElement>(root, "copy");
  const resetButton = el<HTMLButtonElement>(root, "reset");
  const previewSection = el(root, "preview");
  const pages = el<HTMLOListElement>(root, "pages");
  const previewCount = el(root, "preview-count");
  const moreButton = el<HTMLButtonElement>(root, "more");
  const viewer = el<HTMLDialogElement>(root, "viewer");
  const viewerTitle = el(root, "viewer-title");
  const viewerImage = el<HTMLImageElement>(root, "viewer-image");
  const viewerPrev = el<HTMLButtonElement>(root, "viewer-prev");
  const viewerNext = el<HTMLButtonElement>(root, "viewer-next");
  const screens = root.querySelectorAll<HTMLElement>("[data-screen]");

  let lastAnnouncement = "";
  let renderedOrder = "";
  let renderedOutput: ShellState["output"] = null;
  let objectUrls: string[] = [];
  const rows = new Map<string, HTMLLIElement>();
  const thumbnailUrls = new Map<string, string>();

  function announce(message: string) {
    if (!message) return;
    // Repeating the same text would be ignored by screen readers, so vary it invisibly.
    live.textContent = message === lastAnnouncement ? `${message} ` : message;
    lastAnnouncement = live.textContent;
  }

  function focus(target: HTMLElement | null) {
    target?.focus();
  }

  // --- File list ---

  function createRow(queued: QueuedFile) {
    const item = document.createElement("li");
    item.className = "shell-file";
    item.setAttribute("data-testid", "shell-file");
    const order = document.createElement("span");
    order.className = "shell-file-order";
    order.setAttribute("aria-hidden", "true");
    const thumb = document.createElement("span");
    thumb.className = "shell-thumb";
    thumb.hidden = !hasFilePreviews;
    const info = document.createElement("span");
    info.className = "shell-file-info";
    const name = document.createElement("span");
    name.className = "shell-file-name";
    name.textContent = queued.file.name;
    const meta = document.createElement("span");
    meta.className = "shell-file-meta";
    info.append(name, meta);
    const actions = document.createElement("span");
    actions.className = "shell-file-actions";
    item.append(order, thumb, info, actions);
    return item;
  }

  function updateRow(item: HTMLLIElement, queued: QueuedFile, index: number) {
    const [order, thumb, info, actions] = Array.from(item.children) as HTMLElement[];
    order.textContent = String(index + 1);
    const meta = info.lastElementChild as HTMLElement;
    const { text, problem } = fileMeta(queued);
    meta.textContent = text;
    meta.classList.toggle("is-problem", problem);

    const image = queued.preview?.image;
    thumb.classList.toggle("is-loading", hasFilePreviews && !queued.preview);
    if (image && !thumbnailUrls.has(queued.id)) {
      const url = URL.createObjectURL(image);
      thumbnailUrls.set(queued.id, url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      thumb.replaceChildren(img);
    }

    const { id, file } = queued;
    const buttons = [];
    if (index > 0) buttons.push(button(fill(t.moveUp, { name: file.name }), "↑", { action: "up", id }));
    if (index < state.files.length - 1) {
      buttons.push(button(fill(t.moveDown, { name: file.name }), "↓", { action: "down", id }));
    }
    buttons.push(button(fill(t.remove, { name: file.name }), "×", { action: "remove", id }));
    const signature = buttons.map((b) => b.dataset.action).join();
    if (actions.dataset.signature !== signature) {
      actions.dataset.signature = signature;
      actions.replaceChildren(...buttons);
    }
  }

  function renderFiles() {
    if (!list) return;
    const ids = new Set(state.files.map((f) => f.id));
    for (const [id, row] of rows) {
      if (ids.has(id)) continue;
      rows.delete(id);
      row.remove();
      const url = thumbnailUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      thumbnailUrls.delete(id);
    }
    state.files.forEach((queued, index) => {
      let row = rows.get(queued.id);
      if (!row) {
        row = createRow(queued);
        rows.set(queued.id, row);
      }
      updateRow(row, queued, index);
    });
    const order = state.files.map((f) => f.id).join();
    if (order !== renderedOrder) {
      renderedOrder = order;
      list.replaceChildren(...state.files.map((f) => rows.get(f.id) as HTMLLIElement));
    }
    if (total) {
      const count = state.files.length;
      const pageCount = totalPages(state.files);
      const size = formatSize(state.files.reduce((sum, f) => sum + f.file.size, 0));
      total.textContent =
        count === 0
          ? ""
          : [
              plural(count, t.fileOne, t.fileMany),
              ...(pageCount === null ? [] : [plural(pageCount, t.pageOne, t.pageMany)]),
              size,
            ].join(" · ");
    }
  }

  // Previews run one at a time, so several large files don't fill a phone's memory at once.
  const previewed = new Set<string>();
  let previewQueue = Promise.resolve();

  function queuePreviews() {
    const previewFile = tool.previewFile;
    if (!previewFile) return;
    for (const { id, file } of state.files) {
      if (previewed.has(id)) continue;
      previewed.add(id);
      previewQueue = previewQueue.then(async () => {
        if (!state.files.some((f) => f.id === id)) return;
        try {
          controller.setPreview(id, await previewFile(file));
        } catch {
          controller.setPreview(id, { status: "unreadable" });
        }
      });
    }
  }

  // --- Result and its preview ---

  let outputPreview: OutputPreview | null = null;
  let previewToken = 0;
  let shownPages = 0;
  const pageUrls: string[] = [];
  let viewerPage = 1;
  let viewerToken = 0;

  function closeOutputPreview() {
    previewToken++;
    outputPreview?.close();
    outputPreview = null;
    shownPages = 0;
    pageUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    pages.replaceChildren();
    previewSection.hidden = true;
    if (viewer.open) viewer.close();
  }

  function updatePreviewCount() {
    const count = outputPreview?.pageCount ?? 0;
    previewCount.textContent = count > shownPages ? fill(t.showing, { shown: shownPages, total: count }) : "";
    moreButton.hidden = count <= shownPages;
  }

  async function showMorePages() {
    const preview = outputPreview;
    if (!preview) return;
    const token = previewToken;
    const start = shownPages + 1;
    const end = Math.min(preview.pageCount, shownPages + PREVIEW_BATCH);
    const slots: { pageNumber: number; holder: HTMLElement }[] = [];
    for (let pageNumber = start; pageNumber <= end; pageNumber++) {
      const item = document.createElement("li");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "shell-page";
      open.dataset.page = String(pageNumber);
      open.setAttribute("aria-label", fill(t.openPage, { page: pageNumber }));
      const holder = document.createElement("span");
      holder.className = "shell-page-blank";
      const caption = document.createElement("span");
      caption.setAttribute("aria-hidden", "true");
      caption.textContent = fill(t.pageLabel, { page: pageNumber });
      open.append(holder, caption);
      item.append(open);
      pages.append(item);
      slots.push({ pageNumber, holder });
    }
    shownPages = end;
    updatePreviewCount();
    for (const { pageNumber, holder } of slots) {
      try {
        const { blob } = await preview.renderPage(pageNumber, PAGE_THUMBNAIL_WIDTH);
        if (token !== previewToken) return;
        const url = URL.createObjectURL(blob);
        pageUrls.push(url);
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        holder.replaceWith(img);
      } catch {
        if (token !== previewToken) return;
      }
    }
  }

  async function startOutputPreview(blob: Blob) {
    const token = previewToken;
    try {
      const preview = await tool.previewOutput?.(blob);
      if (!preview) return;
      if (token !== previewToken) return preview.close();
      outputPreview = preview;
      previewSection.hidden = false;
      await showMorePages();
    } catch {
      if (token === previewToken) summary.textContent = `${summary.textContent} ${t.previewFailed}`;
    }
  }

  async function showViewerPage(pageNumber: number) {
    const preview = outputPreview;
    if (!preview) return;
    viewerPage = pageNumber;
    const token = ++viewerToken;
    viewerTitle.textContent = fill(t.pageOf, { page: pageNumber, total: preview.pageCount });
    viewerPrev.disabled = pageNumber <= 1;
    viewerNext.disabled = pageNumber >= preview.pageCount;
    // A disabled button drops keyboard focus, so hand it to the button that still works.
    if (viewerPrev.disabled && document.activeElement === viewerPrev) focus(viewerNext);
    if (viewerNext.disabled && document.activeElement === viewerNext) focus(viewerPrev);
    const width = Math.min(1400, Math.round(window.innerWidth * Math.min(window.devicePixelRatio || 1, 2)));
    try {
      const { blob } = await preview.renderPage(pageNumber, width);
      if (token !== viewerToken) return;
      if (viewerImage.src) URL.revokeObjectURL(viewerImage.src);
      viewerImage.src = URL.createObjectURL(blob);
    } catch {
      // The thumbnail is still there to look at, so a failed large render needs no message.
    }
  }

  function renderOutput() {
    if (state.output === renderedOutput) return;
    renderedOutput = state.output;
    closeOutputPreview();
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
    const files = state.output?.files ?? [];
    downloads.hidden = files.length === 0;
    downloads.replaceChildren(
      ...files.map(({ name, blob }) => {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        const safeName = safeFileName(name);
        const link = document.createElement("a");
        link.className = "shell-primary";
        link.href = url;
        link.download = safeName;
        link.textContent = fill(t.download, { name: safeName, size: formatSize(blob.size) });
        const item = document.createElement("li");
        item.append(link);
        return item;
      }),
    );
    const text = state.output?.text;
    output.hidden = text === undefined;
    copyButton.hidden = text === undefined;
    output.textContent = text ?? "";
    summary.textContent = state.output?.summary ?? "";
    resultHeading.textContent =
      text !== undefined ? t.resultText : files.length > 1 ? t.resultMany : t.resultOne;
    if (files.length === 1 && tool.previewOutput) void startOutputPreview(files[0].blob);
  }

  function render() {
    screens.forEach((screen) => (screen.hidden = screen.dataset.screen !== state.screen));
    error.hidden = !state.error;
    error.textContent = state.error ?? "";
    warning.hidden = !state.warning;
    warning.textContent = state.warning ?? "";
    for (const target of [runButton, textInput]) {
      if (!target) continue;
      if (state.error) target.setAttribute("aria-describedby", "shell-error");
      else target.removeAttribute("aria-describedby");
    }
    if (textInput) textInput.setAttribute("aria-invalid", String(Boolean(state.error)));
    if (state.progress === null) progress.removeAttribute("value");
    else progress.value = state.progress;
    status.textContent =
      state.progress === null ? t.working : fill(t.percent, { percent: Math.round(state.progress * 100) });
    renderFiles();
    renderOutput();
    announce(state.announcement);
  }

  function afterFiles(from: "select" | "working") {
    queuePreviews();
    if (from === "select" && state.screen === "working") focus(el(root, "working-heading"));
  }

  function focusAfterRemove(index: number) {
    const buttons = list?.querySelectorAll<HTMLButtonElement>('[data-action="remove"]') ?? [];
    focus(buttons[Math.min(index, buttons.length - 1)] ?? pickInput);
  }

  function focusAfterRun() {
    if (state.screen === "result") focus(resultHeading);
    else if (state.screen === "working") focus(isText ? textInput : runButton);
  }

  controller.subscribe(render);
  render();

  const warm = () => tool.warm?.();
  pickInput?.addEventListener("focus", warm, { once: true });
  zone?.addEventListener("pointerenter", warm, { once: true });

  pickInput?.addEventListener("change", () => {
    warm();
    controller.addFiles(pickInput.files ?? []);
    pickInput.value = "";
    afterFiles("select");
  });

  addInput?.addEventListener("change", () => {
    controller.addFiles(addInput.files ?? []);
    addInput.value = "";
    afterFiles("working");
  });

  list?.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!target) return;
    const { action, id } = target.dataset;
    if (!id) return;
    if (action === "remove") {
      const index = state.files.findIndex((f) => f.id === id);
      controller.removeFile(id);
      if (state.screen === "select") focus(pickInput);
      else focusAfterRemove(index);
      return;
    }
    controller.moveFile(id, action === "up" ? -1 : 1);
    const same = list.querySelector<HTMLButtonElement>(`[data-id="${id}"][data-action="${action}"]`);
    const other = list.querySelector<HTMLButtonElement>(
      `[data-id="${id}"][data-action="${action === "up" ? "down" : "up"}"]`,
    );
    focus(same ?? other);
  });

  textInput?.addEventListener("input", () => controller.setText(textInput.value));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const options: Record<string, string> = {};
    for (const [key, value] of new FormData(form)) {
      if (typeof value === "string") options[key] = value;
    }
    const pending = controller.run(options);
    if (state.screen === "running") focus(el(root, "cancel"));
    await pending;
    if (state.screen !== "running") focusAfterRun();
  });

  el(root, "cancel").addEventListener("click", () => {
    controller.cancel();
    focus(isText ? textInput : runButton);
  });

  resetButton.addEventListener("click", () => {
    controller.reset();
    focus(isText ? textInput : pickInput);
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.output?.text ?? "");
      announce(t.copied);
    } catch {
      announce(t.copyFailed);
    }
  });

  moreButton.addEventListener("click", () => void showMorePages());

  pages.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (!target) return;
    viewer.showModal();
    void showViewerPage(Number(target.dataset.page));
  });
  viewerPrev.addEventListener("click", () => void showViewerPage(viewerPage - 1));
  viewerNext.addEventListener("click", () => void showViewerPage(viewerPage + 1));
  el(root, "viewer-close").addEventListener("click", () => viewer.close());
  document.addEventListener("keydown", (event) => {
    if (!viewer.open) return;
    if (event.key === "ArrowLeft" && viewerPage > 1) void showViewerPage(viewerPage - 1);
    if (event.key === "ArrowRight" && viewerPage < (outputPreview?.pageCount ?? 0)) void showViewerPage(viewerPage + 1);
  });
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  viewer.addEventListener("close", () => {
    viewerToken++;
    focus(pages.querySelector<HTMLButtonElement>(`button[data-page="${viewerPage}"]`));
  });

  // Dropping anywhere on the page adds files, so a missed drop never navigates away.
  const acceptsDrop = (event: DragEvent) =>
    !isText && state.screen !== "running" && state.screen !== "result" && event.dataTransfer?.types.includes("Files");
  document.addEventListener("dragover", (event) => {
    if (acceptsDrop(event)) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    if (!acceptsDrop(event)) return;
    event.preventDefault();
    zone?.classList.remove("is-dragging");
    const from = state.screen === "select" ? "select" : "working";
    warm();
    controller.addFiles(event.dataTransfer?.files ?? []);
    afterFiles(from);
  });
  zone?.addEventListener("dragover", () => zone.classList.add("is-dragging"));
  zone?.addEventListener("dragleave", () => zone.classList.remove("is-dragging"));

  root.dataset.ready = "true";
  return controller;
}
