import { ToolError, type ToolDefinition } from "../../lib/shell/types";

// A stand-in tool for testing the shell. It joins text files and is never built for production.
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".txt,text/plain",
    acceptLabel: "TXT files",
    multiple: true,
    minFiles: 1,
    maxFileSize: 1024,
    warnFileSize: 512,
  },
  async run({ files }, options, { signal, onProgress }) {
    const steps = 5;
    for (let step = 1; step <= steps; step++) {
      await wait(150, signal);
      onProgress(step / steps);
    }
    const failing = files.find((file) => file.name.includes("fail"));
    if (failing) throw new ToolError(`${failing.name} couldn't be read. Remove it and try again.`);
    const texts = await Promise.all(files.map((file) => file.text()));
    const blob = new Blob([texts.join(options.separator || "\n")], { type: "text/plain" });
    const count = files.length;
    return {
      files: [{ name: "joined.txt", blob }],
      summary: `Done. ${count} ${count === 1 ? "file" : "files"} joined into joined.txt.`,
    };
  },
};
