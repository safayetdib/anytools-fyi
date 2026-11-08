import { describe, expect, it } from "vitest";
import { MAX_PARTS, checkRange, clampRange, cleanPageList, compressPages, fileName, parsePageList, planOutputs, type SplitRequest } from "./plan";

type PlannedRequest = Exclude<SplitRequest, { mode: "size" }>;

describe("cleanPageList", () => {
  it("keeps only digits, commas and dashes", () => {
    expect(cleanPageList("2, 5-7, x, 9–10")).toBe("2,5-7,,9–10");
  });
});

describe("parsePageList", () => {
  it.each([
    ["1,5-8", [1, 5, 6, 7, 8]],
    ["  2 ,5 ", [2, 5]],
    ["1–3", [1, 2, 3]],
    ["8-", [8, 9, 10]],
    ["3, 1-2, 2", [1, 2, 3]],
    ["4,", [4]],
  ])("reads %j", (text, pages) => {
    expect(parsePageList(text, 10)).toEqual(pages);
  });

  it("skips pieces that don't make sense instead of refusing the list", () => {
    expect(parsePageList("2, 5-7, 20, x, 9-3, 0", 12)).toEqual([2, 5, 6, 7]);
    expect(parsePageList("", 10)).toEqual([]);
  });
});

describe("clampRange", () => {
  it.each([
    [{ from: 5, to: 20 }, { from: 5, to: 12 }],
    [{ from: 5, to: 3 }, { from: 5, to: 5 }],
    [{ from: 9, to: 5 }, { from: 9, to: 9 }],
    [{ from: 0, to: 4 }, { from: 1, to: 4 }],
    [{ from: Number.NaN, to: Number.NaN }, { from: 1, to: 1 }],
    [{ from: 30, to: 40 }, { from: 12, to: 12 }],
  ])("fixes %j to %j", (range, fixed) => {
    expect(clampRange(range, 12)).toEqual(fixed);
  });
});

describe("checkRange", () => {
  it("accepts a range inside the file", () => {
    expect(checkRange({ from: 2, to: 5 }, 5)).toBeNull();
    expect(checkRange({ from: 3, to: 3 }, 5)).toBeNull();
  });

  it("explains what's wrong", () => {
    expect(checkRange({ from: 4, to: 2 }, 5)).toBe("reversed");
    expect(checkRange({ from: 0, to: 2 }, 5)).toBe("outOfRange");
    expect(checkRange({ from: 2, to: 9 }, 5)).toBe("outOfRange");
    expect(checkRange({ from: Number.NaN, to: 2 }, 5)).toBe("invalid");
  });
});

describe("planOutputs", () => {
  const plan = (request: PlannedRequest, pages = 5) => planOutputs(request, pages);

  it("makes one file per range, overlaps allowed", () => {
    expect(plan({ mode: "ranges", ranges: [{ from: 1, to: 3 }, { from: 3, to: 4 }], merge: false })).toEqual({
      ok: true,
      outputs: [[1, 2, 3], [3, 4]],
      style: "range",
    });
  });

  it("merges all ranges into one file, in order", () => {
    expect(plan({ mode: "ranges", ranges: [{ from: 4, to: 5 }, { from: 1, to: 1 }], merge: true })).toEqual({
      ok: true,
      outputs: [[4, 5, 1]],
      style: "extracted",
    });
  });

  it("refuses a bad range, naming its number", () => {
    expect(plan({ mode: "ranges", ranges: [{ from: 1, to: 2 }, { from: 4, to: 9 }], merge: false })).toEqual({
      ok: false,
      reason: "outOfRange",
      range: "2",
    });
  });

  it("groups fixed ranges, with the rest at the end", () => {
    expect(plan({ mode: "fixed", size: 2 })).toEqual({ ok: true, outputs: [[1, 2], [3, 4], [5]], style: "numbered" });
    expect(plan({ mode: "fixed", size: 0 }, 2)).toEqual({ ok: true, outputs: [[1], [2]], style: "numbered" });
  });

  it("extracts every page", () => {
    expect(plan({ mode: "all" }, 3)).toEqual({ ok: true, outputs: [[1], [2], [3]], style: "page" });
  });

  it("extracts selected pages one by one, or merged", () => {
    expect(plan({ mode: "select", pages: "2, 4-5", merge: false })).toEqual({ ok: true, outputs: [[2], [4], [5]], style: "page" });
    expect(plan({ mode: "select", pages: "2, 4-5", merge: true })).toEqual({ ok: true, outputs: [[2, 4, 5]], style: "extracted" });
    expect(plan({ mode: "select", pages: "7", merge: true })).toMatchObject({ ok: false, reason: "empty" });
  });

  it("refuses more files than the limit", () => {
    expect(plan({ mode: "all" }, MAX_PARTS + 1)).toMatchObject({ ok: false, reason: "tooMany" });
  });
});

describe("compressPages", () => {
  it("turns page lists back into runs", () => {
    expect(compressPages([1, 2, 3, 7, 9, 10])).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 7 },
      { from: 9, to: 10 },
    ]);
    expect(compressPages([4, 5, 1])).toEqual([
      { from: 4, to: 5 },
      { from: 1, to: 1 },
    ]);
  });
});

describe("fileName", () => {
  it("names files the way each mode reads best", () => {
    expect(fileName("Report Final.pdf", [1, 2, 3], 0, "range")).toBe("Report Final-1-3.pdf");
    expect(fileName("report.PDF", [4], 1, "range")).toBe("report-4-4.pdf");
    expect(fileName("scan", [5, 6], 2, "numbered")).toBe("scan-3.pdf");
    expect(fileName("scan.pdf", [9], 8, "page")).toBe("scan-9.pdf");
    expect(fileName("scan.pdf", [1, 4], 0, "extracted")).toBe("scan-extracted.pdf");
  });
});
