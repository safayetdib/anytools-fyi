import { describe, expect, it, vi } from "vitest";
import { createToolController } from "./controller";
import { ToolError, type FileToolConfig, type RunContext, type ToolDefinition, type ToolOutput } from "./types";

const output: ToolOutput = { files: [{ name: "out.txt", blob: new Blob(["ok"]) }], summary: "Done. out.txt" };

function fileTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition & { config: FileToolConfig } {
  return {
    config: {
      mode: "files",
      accept: ".txt,text/plain",
      acceptLabel: "TXT files",
      multiple: true,
      minFiles: 1,
      maxFileSize: 1000,
      warnFileSize: 500,
    },
    run: async () => output,
    ...overrides,
  } as ToolDefinition & { config: FileToolConfig };
}

const txt = (name: string, size = 10) => new File(["x".repeat(size)], name, { type: "text/plain" });

describe("adding files", () => {
  it("moves to the working screen with the files in order", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt"), txt("b.txt")]);
    expect(c.state.screen).toBe("working");
    expect(c.state.files.map((f) => f.file.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects the wrong type, keeps good files and says how to fix it", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt"), new File(["x"], "b.png", { type: "image/png" })]);
    expect(c.state.files).toHaveLength(1);
    expect(c.state.error).toContain("b.png");
    expect(c.state.error).toContain("TXT files");
  });

  it("rejects files over the limit and empty files", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("big.txt", 1001)]);
    expect(c.state.screen).toBe("select");
    expect(c.state.error).toContain("big.txt");
    c.addFiles([new File([], "empty.txt", { type: "text/plain" })]);
    expect(c.state.error).toContain("empty.txt");
  });

  it("warns about large files before processing", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt", 600)]);
    expect(c.state.warning).toBeTruthy();
    c.removeFile(c.state.files[0].id);
    expect(c.state.warning).toBeNull();
  });

  it("replaces the file when the tool takes only one", () => {
    const tool = fileTool();
    tool.config.multiple = false;
    const c = createToolController(tool);
    c.addFiles([txt("a.txt")]);
    c.addFiles([txt("b.txt")]);
    expect(c.state.files.map((f) => f.file.name)).toEqual(["b.txt"]);
  });
});

describe("arranging files", () => {
  it("moves files up and down within the list", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt"), txt("b.txt")]);
    c.moveFile(c.state.files[1].id, -1);
    expect(c.state.files.map((f) => f.file.name)).toEqual(["b.txt", "a.txt"]);
    c.moveFile(c.state.files[0].id, -1);
    expect(c.state.files.map((f) => f.file.name)).toEqual(["b.txt", "a.txt"]);
  });

  it("returns to the select screen when the last file is removed", () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt")]);
    c.removeFile(c.state.files[0].id);
    expect(c.state.screen).toBe("select");
  });
});

describe("running", () => {
  it("passes files in the arranged order and options, then shows the result", async () => {
    const run = vi.fn(async () => output);
    const c = createToolController(fileTool({ run }));
    c.addFiles([txt("a.txt"), txt("b.txt")]);
    c.moveFile(c.state.files[1].id, -1);
    await c.run({ quality: "high" });
    const [input, options] = run.mock.calls[0] as unknown as [{ files: File[] }, unknown];
    expect(input.files.map((f) => f.name)).toEqual(["b.txt", "a.txt"]);
    expect(options).toEqual({ quality: "high" });
    expect(c.state.screen).toBe("result");
    expect(c.state.output).toBe(output);
    expect(c.state.announcement).toBe("Done. out.txt");
  });

  it("refuses to run with too few files and explains why", async () => {
    const tool = fileTool();
    tool.config.minFiles = 2;
    const run = vi.fn(async () => output);
    tool.run = run;
    const c = createToolController(tool);
    c.addFiles([txt("a.txt")]);
    await c.run();
    expect(run).not.toHaveBeenCalled();
    expect(c.state.screen).toBe("working");
    expect(c.state.error).toContain("2");
  });

  it("reports progress", async () => {
    let seen: number | null = null;
    const c = createToolController(
      fileTool({
        run: async (_input, _options, context) => {
          context.onProgress(0.5);
          seen = c.state.progress;
          return output;
        },
      }),
    );
    c.addFiles([txt("a.txt")]);
    await c.run();
    expect(seen).toBe(0.5);
  });

  it("shows a tool's own error message and keeps the files", async () => {
    const c = createToolController(
      fileTool({
        run: async () => {
          throw new ToolError("This PDF has a password. Remove it and try again.");
        },
      }),
    );
    c.addFiles([txt("a.txt")]);
    await c.run();
    expect(c.state.screen).toBe("working");
    expect(c.state.error).toContain("password");
    expect(c.state.files).toHaveLength(1);
  });

  it("never shows raw errors, and gives memory failures their own advice", async () => {
    let failure: Error = new Error("secret internal detail");
    const c = createToolController(
      fileTool({
        run: async () => {
          throw failure;
        },
      }),
    );
    c.addFiles([txt("a.txt")]);
    await c.run();
    expect(c.state.error).not.toContain("secret");
    expect(c.state.error).toBeTruthy();
    failure = new RangeError("Array buffer allocation failed");
    await c.run();
    expect(c.state.error).toMatch(/memory/i);
  });
});

describe("cancelling", () => {
  it("returns at once, aborts the tool, keeps files and ignores a late result", async () => {
    let finish: (value: ToolOutput) => void = () => {};
    let context: RunContext | undefined;
    const c = createToolController(
      fileTool({
        run: (_input, _options, ctx) => {
          context = ctx;
          return new Promise((resolve) => (finish = resolve));
        },
      }),
    );
    c.addFiles([txt("a.txt")]);
    const running = c.run();
    expect(c.state.screen).toBe("running");
    c.cancel();
    expect(context?.signal.aborted).toBe(true);
    expect(c.state.screen).toBe("working");
    expect(c.state.files).toHaveLength(1);
    finish(output);
    await running;
    expect(c.state.screen).toBe("working");
    expect(c.state.output).toBeNull();
  });
});

describe("text tools", () => {
  const textTool = (): ToolDefinition => ({
    config: { mode: "text", inputLabel: "Number" },
    run: async () => ({ text: "out", summary: "Done." }),
  });

  it("starts ready for input and requires text", async () => {
    const c = createToolController(textTool());
    expect(c.state.screen).toBe("working");
    await c.run();
    expect(c.state.screen).toBe("working");
    expect(c.state.error).toBeTruthy();
  });

  it("keeps what was typed after an error and after starting over", async () => {
    const c = createToolController(textTool());
    c.setText("  typed  ");
    await c.run();
    expect(c.state.screen).toBe("result");
    c.reset();
    expect(c.state.screen).toBe("working");
    expect(c.state.text).toBe("  typed  ");
  });
});

describe("starting over", () => {
  it("clears files in file tools", async () => {
    const c = createToolController(fileTool());
    c.addFiles([txt("a.txt")]);
    await c.run();
    c.reset();
    expect(c.state.screen).toBe("select");
    expect(c.state.files).toEqual([]);
    expect(c.state.output).toBeNull();
  });
});

it("notifies subscribers on change", () => {
  const c = createToolController(fileTool());
  const listener = vi.fn();
  c.subscribe(listener);
  c.addFiles([txt("a.txt")]);
  expect(listener).toHaveBeenCalled();
});
