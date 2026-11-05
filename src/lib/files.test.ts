import { describe, expect, it } from "vitest";
import { formatSize, matchesAccept, safeFileName } from "./files";

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [1048576, "1 MB"],
    [2202010, "2.1 MB"],
    [1073741824, "1 GB"],
  ])("formats %d as %s", (bytes, label) => {
    expect(formatSize(bytes)).toBe(label);
  });
});

describe("matchesAccept", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });

  it.each([
    [file("a.PDF", ""), ".pdf", true],
    [file("a.bin", "application/pdf"), "application/pdf", true],
    [file("a.jpg", "image/jpeg"), "image/*", true],
    [file("a.txt", "text/plain"), ".pdf,image/*", false],
  ])("checks %o against %s", (input, accept, expected) => {
    expect(matchesAccept(input, accept)).toBe(expected);
  });

  it("accepts anything when no filter is set", () => {
    expect(matchesAccept(file("a.xyz", ""), undefined)).toBe(true);
  });
});

describe("safeFileName", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\temp\\a.pdf", "a.pdf"],
    ['bad<>:"|?*name.pdf', "bad-name.pdf"],
    ["...", "download"],
    ["", "download"],
  ])("cleans %s", (input, expected) => {
    expect(safeFileName(input)).toBe(expected);
  });
});
