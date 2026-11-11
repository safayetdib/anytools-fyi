import plainCore from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import simdCore from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import workerScript from "tesseract.js/dist/worker.min.js?url";
import { simd } from "wasm-feature-detect";
import type { Language } from "./ocr";

// Runs in the page. The reader (Tesseract) works in its own worker; it and each language are served from this site, so
// nothing about the files goes anywhere. Browsers keep them after the first time.

// Served at a fixed address by the build (see astro.config.mjs), since the reader asks for each language by name.
const LANGUAGE_PATH = "/ocr/4.0.0_best_int";

// Pages are read as pictures at 300 dpi, what Tesseract reads best, with no side over this many pixels so phones cope.
const DPI = 300;
const MAX_SIDE = 4000;

export interface Reader {
  // A one-page PDF of the text found on the canvas, invisible and placed where it was read, and the text itself.
  read(canvas: HTMLCanvasElement, onProgress: (fraction: number) => void): Promise<{ layer: Uint8Array; text: string }>;
  close(): Promise<void>;
}

const absolute = (path: string) => new URL(path, location.href).href;

// How far setting up has got, from the reader's own messages: its engine first, then the languages, which are the
// big download the first time.
const SETUP_STEPS: Record<string, [number, number]> = {
  "loading tesseract core": [0, 0.25],
  "loading language traineddata": [0.25, 0.95],
  "initializing api": [0.95, 1],
};

// Starts the reader with the chosen languages. Setting up is the first part of `onProgress`. The reader fetches each
// language itself, once; the browser keeps it for next time.
export async function openReader(languages: Language[], onProgress: (fraction: number) => void): Promise<Reader> {
  const [{ createWorker, OEM }, fast] = await Promise.all([import("tesseract.js"), simd()]);
  // Where the page being read reports its progress.
  let current: ((fraction: number) => void) | null = null;
  const worker = await createWorker(languages.join("+"), OEM.LSTM_ONLY, {
    workerPath: absolute(workerScript),
    // Devices without SIMD (older phones) get the slower build, which works everywhere.
    corePath: absolute(fast ? simdCore : plainCore),
    langPath: absolute(LANGUAGE_PATH),
    workerBlobURL: false,
    // The browser keeps the languages, so the reader doesn't store a second copy.
    cacheMethod: "none",
    logger: (message) => {
      if (message.status === "recognizing text") current?.(message.progress);
      const step = SETUP_STEPS[message.status];
      if (step) onProgress(step[0] + (step[1] - step[0]) * message.progress);
    },
  });
  await worker.setParameters({ user_defined_dpi: String(DPI) });
  return {
    async read(canvas, onPageProgress) {
      current = onPageProgress;
      try {
        const { data: result } = await worker.recognize(canvas, { pdfTextOnly: true }, { pdf: true, text: true, blocks: false });
        return { layer: new Uint8Array(result.pdf ?? []), text: result.text ?? "" };
      } finally {
        current = null;
      }
    },
    async close() {
      await worker.terminate();
    },
  };
}

// The scale that draws a page of width × height points at the reading resolution.
export function readingScale(width: number, height: number): number {
  return Math.min(DPI / 72, MAX_SIDE / Math.max(width, height));
}
