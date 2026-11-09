import { describe, expect, it } from "vitest";
import { DATE_FORMATS, PEN_SIZES, formatDate, initialsOf, readDate, strokeBounds, todayOf } from "./marks";

describe("formatDate", () => {
  const day = { year: 2026, month: 11, day: 9 };

  it.each([
    ["dmy", "09/11/2026"],
    ["mdy", "11/09/2026"],
    ["iso", "2026-11-09"],
    ["long", "9 November 2026"],
  ] as const)("writes %s as %s", (format, text) => {
    expect(formatDate(day, format)).toBe(text);
  });

  it("offers every format it can write", () => {
    expect(DATE_FORMATS).toEqual(["dmy", "mdy", "iso", "long"]);
  });
});

describe("readDate", () => {
  it("reads the date picker's value, and nothing else", () => {
    expect(readDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(readDate("2026-02-30")).toBeNull();
    expect(readDate("")).toBeNull();
    expect(readDate("28/02/2026")).toBeNull();
  });

  it("takes today from the device's own calendar, not from UTC", () => {
    // Late evening on the 9th, wherever the device is.
    expect(todayOf(new Date(2026, 10, 9, 23, 30))).toEqual({ year: 2026, month: 11, day: 9 });
  });
});

describe("initialsOf", () => {
  it.each([
    ["Safayet Adib", "SA"],
    ["  maria  de la cruz ", "MDLC"],
    ["Ann", "A"],
    ["Md. Rahim Uddin Khan Chowdhury", "MRUK"],
    ["", ""],
  ])("makes %j into %j", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });

  it("keeps a Bangla letter whole, with its vowel sign", () => {
    // "সা" is one letter as written: স with the vowel sign া.
    expect(initialsOf("সাফায়েত আদিব")).toBe("সাআ");
  });
});

describe("strokeBounds", () => {
  it("covers every point and the pen's own width", () => {
    const strokes = [
      [
        { x: 10, y: 20 },
        { x: 50, y: 40 },
      ],
      [{ x: 30, y: 5 }],
    ];
    expect(strokeBounds(strokes, 4)).toEqual({ left: 8, top: 3, width: 44, height: 39 });
  });

  it("has nothing to cover when nothing is drawn", () => {
    expect(strokeBounds([], 4)).toBeNull();
    expect(strokeBounds([[]], 4)).toBeNull();
  });

  it("orders pen sizes from thin to thick", () => {
    expect(PEN_SIZES.thin).toBeLessThan(PEN_SIZES.medium);
    expect(PEN_SIZES.medium).toBeLessThan(PEN_SIZES.thick);
  });
});
