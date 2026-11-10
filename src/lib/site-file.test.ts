import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadSiteFile } from "./site-file";

afterEach(() => vi.unstubAllGlobals());

describe("downloadSiteFile", () => {
  it("reads this site's own files, reporting how much has arrived", async () => {
    vi.stubGlobal("location", new URL("https://anytools.fyi/ocr-pdf/"));
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-length": "4" } }));
    vi.stubGlobal("fetch", fetch);
    const seen: number[] = [];
    expect([...(await downloadSiteFile("/ocr/eng.traineddata.gz", (fraction) => seen.push(fraction)))]).toEqual([1, 2, 3, 4]);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://anytools.fyi/ocr/eng.traineddata.gz");
    expect(seen.at(-1)).toBe(1);
  });

  it("refuses any other site, so nothing can be sent elsewhere", async () => {
    vi.stubGlobal("location", new URL("https://anytools.fyi/ocr-pdf/"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(downloadSiteFile("https://example.com/collect")).rejects.toThrow(/Not one of this site's files/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
