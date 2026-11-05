import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize, matchesAccept } from "../files";
import { ToolError, type FilePreview, type ToolDefinition, type ToolOptions, type ToolOutput } from "./types";

export type Screen = "select" | "working" | "running" | "result";

export interface QueuedFile {
  id: string;
  file: File;
  preview?: FilePreview;
}

// The total page count, once every file has been counted.
export function totalPages(files: QueuedFile[]): number | null {
  if (files.length === 0 || files.some((f) => f.preview?.pageCount === undefined)) return null;
  return files.reduce((sum, f) => sum + (f.preview?.pageCount ?? 0), 0);
}

export interface ShellState {
  screen: Screen;
  files: QueuedFile[];
  text: string;
  error: string | null;
  warning: string | null;
  progress: number | null;
  output: ToolOutput | null;
  announcement: string;
}

const t = en.shell;
let nextId = 0;

function messageFor(error: unknown): string {
  if (error instanceof ToolError) return error.message;
  if (error instanceof RangeError || /memory/i.test(String((error as Error)?.message))) return t.memory;
  return t.failed;
}

export function createToolController(tool: ToolDefinition) {
  const { config } = tool;
  const emptyScreen: Screen = config.mode === "text" ? "working" : "select";
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let runId = 0;

  const state: ShellState = {
    screen: emptyScreen,
    files: [],
    text: "",
    error: null,
    warning: null,
    progress: null,
    output: null,
    announcement: "",
  };

  function update(patch: Partial<ShellState>) {
    Object.assign(state, patch);
    listeners.forEach((listener) => listener());
  }

  function warningFor(files: QueuedFile[]) {
    if (config.mode !== "files" || !config.warnFileSize) return null;
    const limit = config.warnFileSize;
    return files.some(({ file }) => file.size > limit) ? t.largeWarning : null;
  }

  function withFiles(files: QueuedFile[], patch: Partial<ShellState>) {
    update({ files, screen: files.length ? "working" : emptyScreen, warning: warningFor(files), ...patch });
  }

  return {
    state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addFiles(list: ArrayLike<File>) {
      if (config.mode !== "files") return;
      const errors: string[] = [];
      const accepted: QueuedFile[] = [];
      for (const file of Array.from(list)) {
        const name = file.name;
        if (!matchesAccept(file, config.accept)) errors.push(fill(t.wrongType, { name, accept: config.acceptLabel }));
        else if (file.size === 0) errors.push(fill(t.empty, { name }));
        else if (file.size > config.maxFileSize) {
          errors.push(fill(t.tooLarge, { name, limit: formatSize(config.maxFileSize) }));
        } else accepted.push({ id: `file-${nextId++}`, file });
      }
      const files = config.multiple
        ? [...state.files, ...accepted]
        : accepted.length
          ? accepted.slice(-1)
          : state.files;
      const added =
        accepted.length === 0
          ? []
          : [accepted.length === 1 ? fill(t.addedOne, { name: accepted[0].file.name }) : fill(t.addedMany, { count: accepted.length })];
      withFiles(files, {
        error: errors.length ? errors.join(" ") : null,
        output: null,
        announcement: [...added, ...errors].join(" "),
      });
    },

    removeFile(id: string) {
      const removed = state.files.find((f) => f.id === id);
      if (!removed) return;
      withFiles(
        state.files.filter((f) => f.id !== id),
        { error: null, announcement: fill(t.removed, { name: removed.file.name }) },
      );
    },

    moveFile(id: string, direction: -1 | 1) {
      const from = state.files.findIndex((f) => f.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= state.files.length) return;
      const files = [...state.files];
      [files[from], files[to]] = [files[to], files[from]];
      update({ files, announcement: fill(t.moved, { name: files[to].file.name, position: to + 1 }) });
    },

    // Moves a file to an index counted from 0, clamped to the list. Used by dragging.
    moveFileTo(id: string, index: number) {
      const from = state.files.findIndex((f) => f.id === id);
      if (from < 0) return;
      const files = [...state.files];
      const [moved] = files.splice(from, 1);
      const to = Math.min(Math.max(index, 0), files.length);
      files.splice(to, 0, moved);
      update({ files, announcement: fill(t.moved, { name: moved.file.name, position: to + 1 }) });
    },

    setPreview(id: string, preview: FilePreview) {
      const files = state.files.map((f) => (f.id === id ? { ...f, preview } : f));
      const file = files.find((f) => f.id === id);
      if (!file) return;
      const announcement = preview.status === "locked" ? fill(t.lockedAnnounce, { name: file.file.name }) : "";
      update({ files, announcement });
    },

    // Swaps in a rebuilt result, such as the same file with its pages rearranged.
    replaceOutput(output: ToolOutput) {
      if (state.screen !== "result") return;
      update({ output, announcement: output.summary });
    },

    setText(text: string) {
      update({ text, error: null });
    },

    async run(options: ToolOptions = {}) {
      if (config.mode === "files" && state.files.length < config.minFiles) {
        const error = fill(t.tooFew, { count: config.minFiles });
        return update({ error, announcement: error });
      }
      if (config.mode === "text" && !state.text.trim()) {
        return update({ error: t.emptyText, announcement: t.emptyText });
      }
      abort?.abort();
      const controller = new AbortController();
      abort = controller;
      const id = ++runId;
      update({ screen: "running", progress: null, error: null, output: null, announcement: t.working });
      try {
        const output = await tool.run(
          { files: state.files.map((f) => f.file), text: state.text },
          options,
          {
            signal: controller.signal,
            onProgress: (progress) => {
              if (id === runId) update({ progress });
            },
          },
        );
        if (id !== runId) return;
        abort = null;
        update({ screen: "result", output, progress: null, announcement: output.summary });
      } catch (error) {
        if (id !== runId) return;
        abort = null;
        const message = messageFor(error);
        update({ screen: "working", progress: null, error: message, announcement: message });
      }
    },

    cancel() {
      if (state.screen !== "running") return;
      runId++;
      abort?.abort();
      abort = null;
      update({ screen: "working", progress: null, announcement: t.cancelled });
    },

    // Wipes every file, result and typed text, for when the visitor leaves the page.
    clearAll() {
      if (state.screen === "running") this.cancel();
      update({
        screen: emptyScreen,
        files: [],
        text: "",
        output: null,
        error: null,
        warning: null,
        progress: null,
        announcement: "",
      });
    },

    reset() {
      if (state.screen === "running") this.cancel();
      update({
        screen: emptyScreen,
        files: config.mode === "files" ? [] : state.files,
        output: null,
        error: null,
        warning: null,
        progress: null,
        announcement: "",
      });
    },
  };
}

export type ToolController = ReturnType<typeof createToolController>;
