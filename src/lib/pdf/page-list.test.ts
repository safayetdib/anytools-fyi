import { describe, expect, it } from "vitest";
import { checkRange, cleanPageList, compressPages, parsePageList } from "./page-list";

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
