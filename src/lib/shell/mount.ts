import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize, safeFileName } from "../files";
import { createToolController, totalPages, type QueuedFile, type ShellState } from "./controller";
import { createConfirm } from "./confirm";
import { createOutputPages } from "./output-pages";
import type { ToolDefinition } from "./types";

const t = en.shell;
const GRIP_ICON =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/></svg>';
// How close to the screen's top or bottom edge, in pixels, a dragged row must be before the page scrolls.
const DRAG_SCROLL_EDGE = 96;
const DRAG_SCROLL_STEP = 14;
const MORE_ICON =
  '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
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
    item.dataset.id = queued.id;
    // The grip is for mouse and touch dragging. Keyboard users have the arrow buttons and Alt with arrow keys.
    const grip = document.createElement("span");
    grip.className = "shell-file-grip";
    grip.title = t.dragHint;
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = GRIP_ICON;
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
    item.append(grip, order, thumb, info, actions);
    return item;
  }

  function updateRow(item: HTMLLIElement, queued: QueuedFile, index: number) {
    const [, order, thumb, info, actions] = Array.from(item.children) as HTMLElement[];
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
    // Phones show one More button instead, which opens these actions in a sheet.
    const more = button(fill(t.moreFor, { name: file.name }), "", { action: "more", id });
    more.classList.add("shell-file-more");
    more.innerHTML = MORE_ICON;
    more.setAttribute("aria-haspopup", "dialog");
    buttons.push(more);
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
      syncChangesBar();
    },
    // Changes are applied by downloading them, so there's no separate step to miss.
    onApplied(applied) {
      controller.replaceOutput(applied);
      const link = downloads.querySelector("a");
      if (!link) return;
      link.click();
      announce(fill(t.downloadingChanges, { name: link.download }));
      focus(link);
    },
  });

  // While there are changes to download and the result card has scrolled away, a bar keeps the download in reach.
  const changesBar = root.querySelector<HTMLElement>('[data-el="changes-bar"]');
  const resultSummaryCard = root.querySelector<HTMLElement>(".shell-result-card");
  let cardInView = true;
  function syncChangesBar() {
    if (changesBar) changesBar.hidden = !pagesChanged || cardInView;
  }
  if (changesBar && resultSummaryCard && "IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => {
      cardInView = entry.isIntersecting;
      syncChangesBar();
    }).observe(resultSummaryCard);
    el(changesBar, "apply-float").addEventListener("click", () => applyButton.click());
    el(changesBar, "undo-float").addEventListener("click", () => undoButton.click());
  }

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

  const steps = root.querySelector<HTMLElement>('[data-el="steps-text"]');
  const STEP_NAMES = [t.stepSelect, t.stepArrange, t.stepDone];

  let shownScreen = "";

  function render() {
    screens.forEach((screen) => (screen.hidden = screen.dataset.screen !== state.screen));
    // Lets the page count finished jobs. Nothing about the files goes with it.
    if (state.screen === "result" && shownScreen !== "result") {
      root.dispatchEvent(new CustomEvent("anytools:tool-done", { bubbles: true }));
    }
    shownScreen = state.screen;
    // Phones show a step bar and give the tool the bottom of the screen while it's in use.
    if (!isText) {
      const step = state.screen === "select" ? 1 : state.screen === "result" ? 3 : 2;
      root.dataset.step = String(step);
      root.toggleAttribute("data-task", state.screen !== "select");
      if (steps) steps.textContent = fill(t.stepOf, { step, name: STEP_NAMES[step - 1] });
    }
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

  // Focus goes to the same kind of button the person used, whichever is showing at this screen width.
  const visible = (selector: string) =>
    Array.from(list?.querySelectorAll<HTMLButtonElement>(selector) ?? []).filter((b) => b.offsetParent !== null);

  function focusAfterRemove(index: number) {
    const buttons = visible('[data-action="remove"]').length ? visible('[data-action="remove"]') : visible('[data-action="more"]');
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
    if (action === "more") {
      openFileSheet(id);
      return;
    }
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

  // --- A file's actions in a bottom sheet, on phones ---

  const sheet = root.querySelector<HTMLDialogElement>('[data-el="file-sheet"]');
  let sheetFile = "";

  function openFileSheet(id: string) {
    if (!sheet) return;
    const index = state.files.findIndex((f) => f.id === id);
    if (index < 0) return;
    sheetFile = id;
    el(sheet, "file-sheet-title").textContent = state.files[index].file.name;
    sheet.querySelector<HTMLElement>('[data-sheet="up"]')!.hidden = index === 0;
    sheet.querySelector<HTMLElement>('[data-sheet="down"]')!.hidden = index === state.files.length - 1;
    sheet.showModal();
  }

  sheet?.addEventListener("click", (event) => {
    if (event.target === sheet) return sheet.close();
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-sheet]")?.dataset.sheet;
    if (!action) return;
    const id = sheetFile;
    sheet.close();
    if (action === "remove") {
      const index = state.files.findIndex((f) => f.id === id);
      controller.removeFile(id);
      if (state.screen === "select") focus(pickInput);
      else focusAfterRemove(index);
    } else if (action === "up" || action === "down") {
      controller.moveFile(id, action === "up" ? -1 : 1);
      focus(list?.querySelector<HTMLElement>(`[data-id="${id}"][data-action="more"]`) ?? null);
    }
  });

  sheet?.addEventListener("close", () => {
    const more = list?.querySelector<HTMLElement>(`[data-id="${sheetFile}"][data-action="more"]`);
    if (more && document.activeElement === document.body) focus(more);
  });

  // Alt with an up or down arrow moves the focused row, like the page editor.
  list?.addEventListener("keydown", (event) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const row = (event.target as HTMLElement).closest<HTMLLIElement>(".shell-file");
    const id = row?.dataset.id;
    if (!id) return;
    event.preventDefault();
    const focused = document.activeElement as HTMLElement | null;
    controller.moveFile(id, event.key === "ArrowUp" ? -1 : 1);
    const action = focused?.dataset.action;
    const again =
      (focused?.isConnected ? focused : null) ??
      list.querySelector<HTMLElement>(`[data-id="${id}"][data-action="${action}"]`) ??
      list.querySelector<HTMLElement>(`[data-id="${id}"][data-action="remove"]`);
    focus(again);
  });

  // Dragging a row by its grip. Pointer events cover both mouse and touch.
  let drag: { id: string; row: HTMLLIElement; from: number; to: number; startY: number; startScroll: number } | null =
    null;

  function dropIndex(pointerY: number) {
    if (!drag || !list) return 0;
    const others = Array.from(list.children).filter((row) => row !== drag?.row) as HTMLElement[];
    const before = others.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return pointerY < box.top + box.height / 2;
    });
    return before === -1 ? others.length : before;
  }

  function showDropLine(index: number) {
    if (!list || !drag) return;
    const others = Array.from(list.children).filter((row) => row !== drag?.row) as HTMLElement[];
    others.forEach((row) => row.classList.remove("is-drop-before", "is-drop-after"));
    if (index < others.length) others[index].classList.add("is-drop-before");
    else others.at(-1)?.classList.add("is-drop-after");
  }

  function endDrag() {
    if (!drag || !list) return;
    const { id, row, from, to } = drag;
    drag = null;
    row.classList.remove("is-dragging");
    row.style.transform = "";
    list.querySelectorAll(".is-drop-before, .is-drop-after").forEach((other) => {
      other.classList.remove("is-drop-before", "is-drop-after");
    });
    if (to !== from) controller.moveFileTo(id, to);
  }

  list?.addEventListener("pointerdown", (event) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>(".shell-file-grip");
    const row = grip?.closest<HTMLLIElement>(".shell-file");
    if (!grip || !row?.dataset.id || event.button > 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const from = Array.from(list.children).indexOf(row);
    drag = { id: row.dataset.id, row, from, to: from, startY: event.clientY, startScroll: window.scrollY };
    row.classList.add("is-dragging");
  });

  list?.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (event.clientY < DRAG_SCROLL_EDGE) window.scrollBy(0, -DRAG_SCROLL_STEP);
    else if (event.clientY > window.innerHeight - DRAG_SCROLL_EDGE) window.scrollBy(0, DRAG_SCROLL_STEP);
    const offset = event.clientY - drag.startY + (window.scrollY - drag.startScroll);
    drag.row.style.transform = `translateY(${offset}px)`;
    drag.to = dropIndex(event.clientY);
    showDropLine(drag.to);
  });

  list?.addEventListener("pointerup", endDrag);
  list?.addEventListener("pointercancel", () => {
    if (drag) drag.to = drag.from;
    endDrag();
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
