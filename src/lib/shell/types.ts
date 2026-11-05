export interface FileToolConfig {
  mode: "files";
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

// The shell only knows this contract, so a tool can run in a worker, or later on a server, without shell changes.
export interface ToolDefinition {
  config: ToolConfig;
  run(input: ToolInput, options: ToolOptions, context: RunContext): Promise<ToolOutput>;
}

// Its message is shown to the visitor, so it must say what went wrong and how to fix it.
export class ToolError extends Error {}
