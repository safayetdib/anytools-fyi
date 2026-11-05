import type { FilePreview, OutputPreview, RenderedPage } from "../shell/types";

type Pdfjs = typeof import("pdfjs-dist");
type LoadingTask = ReturnType<Pdfjs["getDocument"]>;
type PdfDocument = Awaited<LoadingTask["promise"]>;

let pdfjs: Promise<Pdfjs> | undefined;

// pdf.js is large, so it loads only when a visitor starts working with PDFs.
export function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjs;
}

// Closing the loading task frees the document and its share of the pdf.js worker.
async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocument; close: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    throw error;
  }
}

export async function renderPage(doc: PdfDocument, pageNumber: number, width: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Render failed"))), "image/jpeg", 0.85),
    );
    canvas.width = 0;
    canvas.height = 0;
    return { blob, width: Math.round(viewport.width), height: Math.round(viewport.height) };
  } finally {
    page.cleanup();
  }
}

const isPasswordError = (error: unknown) => (error as Error)?.name === "PasswordException";

export async function previewPdfFile(file: File, width: number): Promise<FilePreview> {
  let opened: Awaited<ReturnType<typeof openPdf>> | undefined;
  try {
    opened = await openPdf(new Uint8Array(await file.arrayBuffer()));
    const { blob } = await renderPage(opened.doc, 1, width);
    return { status: "ready", image: blob, pageCount: opened.doc.numPages };
  } catch (error) {
    return { status: isPasswordError(error) ? "locked" : "unreadable" };
  } finally {
    opened?.close();
  }
}

export async function previewPdfOutput(blob: Blob): Promise<OutputPreview> {
  const { doc, close } = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  return {
    pageCount: doc.numPages,
    renderPage: (pageNumber, width) => renderPage(doc, pageNumber, width),
    close,
  };
}
