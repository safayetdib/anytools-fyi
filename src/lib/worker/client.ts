import type { RunContext } from "../shell/types";

type Message<Response> =
  | { id: number; type: "progress"; value: number }
  | { id: number; type: "done"; result: Response }
  | { id: number; type: "error"; error: { code: string; detail?: string } | null };

// A JobError raised inside the worker, passed back with its code and detail.
export class WorkerJobFailed extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

// Keeps one worker per tool. Cancelling terminates it, so heavy work stops at once, then starts a fresh one.
export function createWorkerRunner<Request, Response>(create: () => Worker) {
  let worker: Worker | null = null;
  let nextId = 0;

  function warm() {
    worker ??= create();
    return worker;
  }

  function stop() {
    worker?.terminate();
    worker = null;
  }

  function run(payload: Request, transfer: Transferable[], { signal, onProgress }: RunContext): Promise<Response> {
    const active = warm();
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        active.removeEventListener("message", onMessage);
        active.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
      };
      const onMessage = (event: MessageEvent<Message<Response>>) => {
        const message = event.data;
        if (message.id !== id) return;
        if (message.type === "progress") return onProgress(message.value);
        cleanup();
        if (message.type === "done") resolve(message.result);
        else reject(message.error ? new WorkerJobFailed(message.error.code, message.error.detail) : new Error("Job failed"));
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        stop();
        reject(new Error(event.message || "Worker failed"));
      };
      const onAbort = () => {
        cleanup();
        stop();
        warm();
        reject(signal.reason);
      };
      if (signal.aborted) return onAbort();
      active.addEventListener("message", onMessage);
      active.addEventListener("error", onError);
      signal.addEventListener("abort", onAbort, { once: true });
      active.postMessage({ id, payload }, transfer);
    });
  }

  return { warm, run, stop };
}
