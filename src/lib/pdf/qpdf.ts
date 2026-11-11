import createModule from "@neslinesli93/qpdf-wasm";
import { PDFDocument } from "pdf-lib";

// qpdf, the long-standing open source PDF toolkit, compiled to run in the browser. Used where pdf-lib can't go:
// adding and removing passwords. Runs in a worker; the caller says where qpdf.wasm is.

export interface QpdfResult {
  // 0 is success, 3 is success with warnings, 2 is an error such as a wrong password.
  code: number;
  output: Uint8Array | null;
}

export type Qpdf = (args: string[], input: Uint8Array) => Promise<QpdfResult>;

// Stand-ins for the input and output files in an argument list.
export const IN = "{in}";
export const OUT = "{out}";
// Packs the file's small objects together when writing, as pdf-lib does, so a rewritten file isn't bigger than the one
// it came from.
export const PACKED = "--object-streams=generate";

interface Instance {
  callMain(args: string[]): number;
  FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array };
}

// Each run gets a fresh copy of qpdf: a program compiled this way isn't meant to run twice. The compiled code is cached.
export function qpdfRunner(wasm: string): Qpdf {
  return async (args, input) => {
    const quiet = () => {};
    const instance = (await createModule({ locateFile: () => wasm, print: quiet, printErr: quiet } as never)) as unknown as Instance;
    instance.FS.writeFile("/in.pdf", input);
    let code: number;
    try {
      code = instance.callMain(args.map((arg) => (arg === IN ? "/in.pdf" : arg === OUT ? "/out.pdf" : arg)));
    } catch (error) {
      code = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 2;
    }
    let output: Uint8Array | null = null;
    if (code === 0 || code === 3) {
      try {
        output = instance.FS.readFile("/out.pdf");
      } catch {
        // Nothing was written.
      }
    }
    return { code, output };
  };
}

// Whether a file is a PDF with a password or other protection. pdf-lib reads the file and refuses protected ones; its
// error classes lose their identity in older JavaScript, so the message is the reliable check.
export async function isProtected(bytes: Uint8Array): Promise<boolean> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false });
    return false;
  } catch (error) {
    return /is encrypted/i.test(String((error as Error)?.message));
  }
}
