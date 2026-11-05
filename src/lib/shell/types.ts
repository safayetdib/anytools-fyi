export interface FileToolConfig {
  mode: "files";
  // Shown under the file list heading, to say what the order or options mean for this tool.
  arrangeHint?: string;
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

export interface ToolOutput {
  files?: { name: string; blob: Blob }[];
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
}

export interface OutputPreview {
  pageCount: number;
  // Rotation is extra clockwise turning, on top of the page's own, so previews match unapplied changes.
  renderPage(pageNumber: number, width: number, rotation?: number): Promise<RenderedPage>;
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
  pages: { page: number; rotate: 0 | 90 | 180 | 270 }[];
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
