import { toScreen, type CropRect } from "../shell/crop";
import type { FilePreview, OutputPreview, RenderedPage } from "../shell/types";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type LoadingTask = ReturnType<Pdfjs["getDocument"]>;
export type PdfDocument = Awaited<LoadingTask["promise"]>;

let pdfjs: Promise<Pdfjs> | undefined;

// pdf.js is large, so it loads only when a visitor starts working with PDFs.
// The legacy build carries fallbacks for newer JavaScript that Safari on iPhone lacks.
export function loadPdfjs(): Promise<Pdfjs> {
  pdfjs ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]).then(
    ([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    },
  );
  return pdfjs;
}

// Closing the loading task frees the document and its share of the pdf.js worker.
export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocument; close: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    throw error;
  }
}

// Browsers refuse canvases much larger than this, so very small crops are drawn at a lower scale.
const MAX_CANVAS_SIDE = 4096;

// Extra rotation turns the page further clockwise, on top of its own rotation.
// A crop, in fractions of the unturned page, draws only that part, `width` pixels wide.
export async function renderPage(
  doc: PdfDocument,
  pageNumber: number,
  width: number,
  rotation = 0,
  crop?: CropRect,
): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  try {
    const turn = (page.rotate + rotation) % 360;
    const area = crop ? toScreen(crop, turn) : { x: 0, y: 0, width: 1, height: 1 };
    const base = page.getViewport({ scale: 1, rotation: turn });
    const scale = Math.min(
      width / (base.width * area.width),
      MAX_CANVAS_SIDE / Math.max(base.width, base.height),
    );
    const viewport = page.getViewport({ scale, rotation: turn });
    const full = document.createElement("canvas");
    full.width = Math.round(viewport.width);
    full.height = Math.round(viewport.height);
    await page.render({ canvas: full, viewport, background: "#ffffff" }).promise;
    let canvas = full;
    if (crop) {
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(area.width * full.width));
      canvas.height = Math.max(1, Math.round(area.height * full.height));
      canvas
        .getContext("2d")
        ?.drawImage(full, area.x * full.width, area.y * full.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      full.width = 0;
      full.height = 0;
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Render failed"))), "image/jpeg", 0.85),
    );
    const size = { width: canvas.width, height: canvas.height };
    canvas.width = 0;
    canvas.height = 0;
    return { blob, ...size, turn };
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
    renderPage: (pageNumber, width, rotation, crop) => renderPage(doc, pageNumber, width, rotation, crop),
    close,
  };
}
