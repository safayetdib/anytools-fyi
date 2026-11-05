import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize, safeFileName } from "../files";
import { createToolController, totalPages, type QueuedFile, type ShellState } from "./controller";
import { createConfirm } from "./confirm";
import { createOutputPages } from "./output-pages";
import type { ToolDefinition } from "./types";

const t = en.shell;
const DOWNLOAD_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/></svg>';

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
  const clearFiles = root.querySelector<HTMLButtonElement>('[data-el="clear-files"]');
  const changedNote = el(root, "changed");
  const applyButton = el<HTMLButtonElement>(root, "apply");
  const undoButton = el<HTMLButtonElement>(root, "undo");
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

  // --- Leaving the page ---

  let downloaded = false;
  let pagesChanged = false;
  let guarding = false;

  // Work that would be lost: chosen files not yet merged, or a result not downloaded or with unapplied changes.
  function hasUnsavedWork() {
    if (isText) return false;
    if (state.screen === "result") return !downloaded || pagesChanged;
    return state.files.length > 0;
  }

  function warnBeforeLeaving(event: BeforeUnloadEvent) {
    event.preventDefault();
    // Older browsers only show the prompt when returnValue is set too.
    event.returnValue = "";
  }

  // The listener is only added while there's work to lose, so it never slows down Back and Forward otherwise.
  function syncLeaveGuard() {
    const needed = hasUnsavedWork();
    if (needed === guarding) return;
    guarding = needed;
    if (needed) window.addEventListener("beforeunload", warnBeforeLeaving);
    else window.removeEventListener("beforeunload", warnBeforeLeaving);
  }

  // --- Result ---

  const outputPages = createOutputPages(root, tool, {
    announce,
    confirm: (options) => resultConfirm?.ask(options) ?? Promise.resolve(true),
    onChange(changed) {
      pagesChanged = changed;
      syncLeaveGuard();
      downloads.hidden = changed || (state.output?.files ?? []).length === 0;
      changedNote.hidden = !changed;
      applyButton.hidden = !changed;
      undoButton.hidden = !changed;
    },
    onApplied(applied) {
      controller.replaceOutput(applied);
      focus(downloads.querySelector("a"));
    },
  });

  function renderOutput() {
    if (state.output === renderedOutput) return;
    renderedOutput = state.output;
    downloaded = false;
    outputPages.close();
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
        link.insertAdjacentHTML("afterbegin", DOWNLOAD_ICON);
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
    if (files.length === 1 && tool.previewOutput) void outputPages.load(files[0]);
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
    syncLeaveGuard();
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

  // Anything that throws work away asks first, with the same card everywhere.
  const clearCard = root.querySelector<HTMLElement>('[data-el="clear-confirm"]');
  const resultCard = root.querySelector<HTMLElement>('[data-el="result-confirm"]');
  const clearConfirm = clearCard ? createConfirm(clearCard) : null;
  const resultConfirm = resultCard ? createConfirm(resultCard) : null;

  controller.subscribe(() => {
    if (state.screen !== "working") clearConfirm?.dismiss();
    if (state.screen !== "result") resultConfirm?.dismiss();
  });

  clearFiles?.addEventListener("click", async () => {
    const count = state.files.length;
    const confirmed = await clearConfirm?.ask({
      question: count === 1 ? t.clearQuestionOne : fill(t.clearQuestionMany, { count }),
      yes: t.clearYes,
      no: t.clearNo,
      returnFocus: clearFiles,
    });
    if (!confirmed) return;
    controller.reset();
    focus(pickInput);
  });

  resetButton.addEventListener("click", async () => {
    // Text tools keep what was typed, so going back loses nothing and needs no question.
    if (!isText) {
      const confirmed = await resultConfirm?.ask({
        question: t.resetQuestion,
        yes: t.clearYes,
        no: t.resetNo,
        returnFocus: resetButton,
      });
      if (!confirmed) return;
    }
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

  downloads.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest("a")) return;
    downloaded = true;
    syncLeaveGuard();
  });

  // Leaving the page wipes everything, so Back never brings someone's files back into view.
  window.addEventListener("pagehide", () => {
    clearConfirm?.dismiss();
    resultConfirm?.dismiss();
    controller.clearAll();
    if (textInput) textInput.value = "";
    if (pickInput) pickInput.value = "";
    if (addInput) addInput.value = "";
  });

  root.dataset.ready = "true";
  return controller;
}
