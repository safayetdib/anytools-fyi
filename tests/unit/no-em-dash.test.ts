import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The site's writing never uses em dashes: commas, colons or full stops read better.
const EM_DASH = String.fromCharCode(0x2014);
const SKIP = /(^|\/)package-lock\.json$|\.(png|jpe?g|webp|ico|pdf|woff2?|ttf|zip)$/i;

describe("writing style", () => {
  it("has no em dashes in any project file", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter((file) => file && !SKIP.test(file));
    const found = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => (line.includes(EM_DASH) ? [`${file}:${index + 1}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
