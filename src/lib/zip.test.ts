import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makePdf, pageWidths } from "../../tests/fixtures/pdf";
import { zipParts } from "./zip";

describe("zipParts", () => {
  it("packs every part under its own name", async () => {
    const a = await makePdf([10]);
    const b = await makePdf([20, 30]);
    const files = unzipSync(zipParts([{ name: "x-1.pdf", bytes: a }, { name: "x-2.pdf", bytes: b }]));
    expect(Object.keys(files)).toEqual(["x-1.pdf", "x-2.pdf"]);
    expect(await pageWidths(files["x-2.pdf"])).toEqual([20, 30]);
  });

  it("keeps names unique", () => {
    const one = new Uint8Array([1]);
    const files = unzipSync(zipParts([{ name: "a.pdf", bytes: one }, { name: "a.pdf", bytes: one }]));
    expect(Object.keys(files)).toEqual(["a.pdf", "a (2).pdf"]);
  });
});
