// Runs inside a Web Worker: receives jobs from createWorkerRunner and posts back progress and results.

// An expected failure the page can explain, such as a password-protected file.
export class JobError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<{ id: number; payload: unknown }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

export function serveJobs<Request, Response>(
  handler: (
    payload: Request,
    progress: (fraction: number) => void,
  ) => Promise<{ result: Response; transfer?: Transferable[] }>,
) {
  const scope = self as unknown as WorkerScope;
  scope.onmessage = async (event) => {
    const { id, payload } = event.data;
    try {
      const { result, transfer = [] } = await handler(payload as Request, (value) =>
        scope.postMessage({ id, type: "progress", value }),
      );
      scope.postMessage({ id, type: "done", result }, transfer);
    } catch (error) {
      const known = error instanceof JobError ? { code: error.code, detail: error.detail } : null;
      scope.postMessage({ id, type: "error", error: known });
    }
  };
}
