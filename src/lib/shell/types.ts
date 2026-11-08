import type { CropRect } from "./crop";

export interface FileToolConfig {
  mode: "files";
  // Shown under the file list heading, to say what the order or options mean for this tool.
  arrangeHint?: string;
  // False when the files' order makes no difference, like rotating them, so phones don't get the reordering hint.
  orderMatters?: boolean;
  accept?: string;
  acceptLabel: string;
  multiple: boolean;
  minFiles: number;
  maxFileSize: number;
  warnFileSize?: number;
}

export interface TextToolConfig {
  mode: "text";
  inputLabel: string;
}

export type ToolConfig = FileToolConfig | TextToolConfig;

export interface ToolInput {
  files: File[];
  text: string;
}

export type ToolOptions = Record<string, string>;

export interface RunContext {
  signal: AbortSignal;
  // A fraction from 0 to 1, or null when progress can't be measured.
  onProgress(fraction: number | null): void;
}

// One of several files a tool made, such as each part of a split PDF.
export interface OutputPart {
  name: string;
  blob: Blob;
  // What the part holds, such as "Pages 1–3".
  label: string;
}

export interface ToolOutput {
  // The main download. With parts, this is usually a ZIP of all of them.
  files?: { name: string; blob: Blob }[];
  // Shown as cards under the result, each with a preview and its own download.
  parts?: OutputPart[];
  text?: string;
  summary: string;
}

export interface FilePreview {
  status: "ready" | "locked" | "unreadable";
  image?: Blob;
  pageCount?: number;
}

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
  // The page's total clockwise turn as drawn, including any rotation it already had.
  turn: number;
}

export interface OutputPreview {
  pageCount: number;
  // Rotation is extra clockwise turning, on top of the page's own, so previews match unapplied changes.
  renderPage(pageNumber: number, width: number, rotation?: number, crop?: CropRect): Promise<RenderedPage>;
  close(): void;
}

export type PageSize =
  | "original"
  | "a4-portrait"
  | "a4-landscape"
  | "a4-auto"
  | "letter-portrait"
  | "letter-landscape"
  | "letter-auto";

// How to rebuild a result: which pages to keep, in order, how far to turn each one clockwise, and the sheet size.
export interface PagePlan {
  // Crops are fractions of the page before turning, as in ./crop.
  pages: { page: number; rotate: 0 | 90 | 180 | 270; crop?: CropRect }[];
  pageSize: PageSize;
}

// The shell only knows this contract, so a tool can run in a worker, or later on a server, without shell changes.
export interface ToolDefinition {
  config: ToolConfig;
  // Starts loading heavy code early, when the visitor shows intent, so it's ready (and works offline) by run time.
  warm?(): void;
  // Optional previews: a thumbnail for each chosen file, and the pages of the result before download.
  previewFile?(file: File): Promise<FilePreview>;
  previewOutput?(blob: Blob): Promise<OutputPreview>;
  // Rebuilds the result from a page plan: new order, removed pages, rotation and sheet size.
  rearrangeOutput?(file: { name: string; blob: Blob }, plan: PagePlan, context: RunContext): Promise<ToolOutput>;
  run(input: ToolInput, options: ToolOptions, context: RunContext): Promise<ToolOutput>;
}

// Its message is shown to the visitor, so it must say what went wrong and how to fix it.
export class ToolError extends Error {}
