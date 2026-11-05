import { describe, expect, it } from "vitest";
import { isChanged, movePage, movePageTo, moveSelectedTo, removePage } from "./page-order";

describe("page order", () => {
  const order = [1, 2, 3, 4];

  it("moves a page one place earlier or later", () => {
    expect(movePage(order, 2, -1)).toEqual([1, 3, 2, 4]);
    expect(movePage(order, 2, 1)).toEqual([1, 2, 4, 3]);
  });

  it("ignores moves past either end", () => {
    expect(movePage(order, 0, -1)).toEqual(order);
    expect(movePage(order, 3, 1)).toEqual(order);
  });

  it("moves a page to a position, counted from 1, and clamps it", () => {
    expect(movePageTo(order, 3, 1)).toEqual([4, 1, 2, 3]);
    expect(movePageTo(order, 0, 3)).toEqual([2, 3, 1, 4]);
    expect(movePageTo(order, 0, 99)).toEqual([2, 3, 4, 1]);
    expect(movePageTo(order, 3, 0)).toEqual([4, 1, 2, 3]);
  });

  it("removes a page but never the last one", () => {
    expect(removePage(order, 1)).toEqual([1, 3, 4]);
    expect(removePage([7], 0)).toEqual([7]);
  });

  it("never changes the original list", () => {
    movePage(order, 1, 1);
    removePage(order, 0);
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("knows when the order differs from the original", () => {
    expect(isChanged([1, 2, 3], 3)).toBe(false);
    expect(isChanged([2, 1, 3], 3)).toBe(true);
    expect(isChanged([1, 2], 3)).toBe(true);
  });
});

describe("moving selected pages", () => {
  it("moves several pages as a block, keeping their order", () => {
    expect(moveSelectedTo([1, 2, 3, 4, 5], new Set([4, 2]), 1)).toEqual([2, 4, 1, 3, 5]);
    expect(moveSelectedTo([1, 2, 3, 4, 5], new Set([1, 2]), 4)).toEqual([3, 4, 5, 1, 2]);
  });

  it("clamps the position to the list", () => {
    expect(moveSelectedTo([1, 2, 3], new Set([1]), 99)).toEqual([2, 3, 1]);
    expect(moveSelectedTo([1, 2, 3], new Set([3]), 0)).toEqual([3, 1, 2]);
  });
});
