import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf, pageWidths } from "../../../tests/fixtures/pdf";
import { MergeError, mergePdfs } from "./merge";

describe("mergePdfs", () => {
  it("joins every page in the given file order", async () => {
    const result = await mergePdfs(
      [
        { name: "b.pdf", bytes: await makePdf([200, 210]) },
        { name: "a.pdf", bytes: await makePdf([100]) },
      ],
      () => {},
    );
    expect(result.pageCount).toBe(3);
    expect(await pageWidths(result.bytes)).toEqual([200, 210, 100]);
  });

  it("reports progress that rises to 1", async () => {
    const seen: number[] = [];
    await mergePdfs(
      [
        { name: "a.pdf", bytes: await makePdf([100]) },
        { name: "b.pdf", bytes: await makePdf([100]) },
      ],
      (value) => seen.push(value),
    );
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(seen.at(-1)).toBe(1);
  });

  it("names a password-protected file", async () => {
    const files = [
      { name: "ok.pdf", bytes: await makePdf([100]) },
      { name: "locked.pdf", bytes: await makeEncryptedPdf() },
    ];
    await expect(mergePdfs(files, () => {})).rejects.toEqual(new MergeError("encrypted", "locked.pdf"));
  });

  it("names a file that isn't a readable PDF", async () => {
    const files = [
      { name: "ok.pdf", bytes: await makePdf([100]) },
      { name: "broken.pdf", bytes: new TextEncoder().encode("not a pdf at all") },
    ];
    await expect(mergePdfs(files, () => {})).rejects.toEqual(new MergeError("unreadable", "broken.pdf"));
  });
});
