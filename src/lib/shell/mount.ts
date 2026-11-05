import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize, safeFileName } from "../files";
import { createToolController, type ShellState } from "./controller";
import type { ToolDefinition } from "./types";

const t = en.shell;

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

export function mountToolShell(root: HTMLElement, tool: ToolDefinition) {
  const controller = createToolController(tool);
  const { state } = controller;
  const isText = tool.config.mode === "text";

  const live = el(root, "live");
  const error = el(root, "error");
  const warning = el(root, "warning");
  const zone = root.querySelector<HTMLElement>('[data-el="zone"]');
  const pickInput = root.querySelector<HTMLInputElement>('[data-el="pick-input"]');
  const addInput = root.querySelector<HTMLInputElement>('[data-el="add-input"]');
  const form = el<HTMLFormElement>(root, "form");
  const list = root.querySelector<HTMLOListElement>('[data-el="list"]');
  const textInput = root.querySelector<HTMLTextAreaElement>('[data-el="text"]');
  const runButton = el<HTMLButtonElement>(root, "run");
  const progress = el<HTMLProgressElement>(root, "progress");
  const status = el(root, "status");
  const resultHeading = el(root, "result-heading");
  const downloads = el<HTMLUListElement>(root, "downloads");
  const output = el(root, "output");
  const copyButton = el<HTMLButtonElement>(root, "copy");
  const resetButton = el<HTMLButtonElement>(root, "reset");
  const screens = root.querySelectorAll<HTMLElement>("[data-screen]");

  let lastAnnouncement = "";
  let renderedFiles = "";
  let renderedOutput: ShellState["output"] = null;
  let objectUrls: string[] = [];

  function announce(message: string) {
    if (!message) return;
    // Repeating the same text would be ignored by screen readers, so vary it invisibly.
    live.textContent = message === lastAnnouncement ? `${message} ` : message;
    lastAnnouncement = live.textContent;
  }

  function focus(target: HTMLElement | null) {
    target?.focus();
  }

  function renderFiles() {
    if (!list) return;
    const key = state.files.map((f) => f.id).join();
    if (key === renderedFiles) return;
    renderedFiles = key;
    list.replaceChildren(
      ...state.files.map(({ id, file }, index) => {
        const item = document.createElement("li");
        item.className = "shell-file";
        item.setAttribute("data-testid", "shell-file");
        const name = document.createElement("span");
        name.className = "shell-file-name";
        name.textContent = file.name;
        const size = document.createElement("span");
        size.className = "shell-file-size";
        size.textContent = formatSize(file.size);
        const actions = document.createElement("span");
        actions.className = "shell-file-actions";
        if (index > 0) actions.append(button(fill(t.moveUp, { name: file.name }), "↑", { action: "up", id }));
        if (index < state.files.length - 1) {
          actions.append(button(fill(t.moveDown, { name: file.name }), "↓", { action: "down", id }));
        }
        actions.append(button(fill(t.remove, { name: file.name }), "×", { action: "remove", id }));
        item.append(name, size, actions);
        return item;
      }),
    );
  }

  function renderOutput() {
    if (state.output === renderedOutput) return;
    renderedOutput = state.output;
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
    resultHeading.textContent =
      text !== undefined ? t.resultText : files.length > 1 ? t.resultMany : t.resultOne;
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
    if (from === "select" && state.screen === "working") focus(el(root, "working-heading"));
  }

  function focusAfterRemove(index: number) {
    const rows = list?.querySelectorAll<HTMLButtonElement>('[data-action="remove"]') ?? [];
    focus(rows[Math.min(index, rows.length - 1)] ?? pickInput);
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
