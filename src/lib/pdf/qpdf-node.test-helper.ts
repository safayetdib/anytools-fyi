import { createRequire } from "node:module";
import { qpdfRunner } from "./qpdf";

// qpdf for unit tests, reading qpdf.wasm from node_modules.
export const nodeQpdf = qpdfRunner(createRequire(import.meta.url).resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm"));
