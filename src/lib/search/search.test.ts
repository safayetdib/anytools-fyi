import { describe, expect, it } from "vitest";
import { buildSearchEntries } from "./entries";
import { createSearch, normalize } from "./search";

const search = createSearch(buildSearchEntries());
const top = (query: string) => search(query)[0]?.slug;
const slugs = (query: string) => search(query).map((r) => r.slug);

describe("normalize", () => {
  it("lowercases, strips punctuation and splits letters from numbers", () => {
    expect(normalize("Compress-Image to 20KB!")).toBe("compress image to 20 kb");
    expect(normalize("base64")).toBe("base 64");
  });

  it("keeps Bangla letters and vowel signs, and reads Bangla digits", () => {
    expect(normalize("ছবি ২০ কেবি")).toBe("ছবি 20 কেবি");
    expect(normalize("বিজয়")).toBe("বিজয়");
  });
});

describe("finds the closest tool", () => {
  it.each([
    ["merge", "merge-pdf"],
    ["Merge PDF", "merge-pdf"],
    ["combine pdf", "merge-pdf"],
    ["join pdfs", "merge-pdf"],
    ["mrege pdf", "merge-pdf"],
    ["marge", "merge-pdf"],
    ["mer", "merge-pdf"],
    ["split", "split-pdf"],
    ["extract pages", "split-pdf"],
    ["jpg to pdf", "jpg-to-pdf"],
    ["jpeg to pdf", "jpg-to-pdf"],
    ["png to pdf", "jpg-to-pdf"],
    ["pictures to pdf", "jpg-to-pdf"],
    ["pdf to jpg", "pdf-to-jpg"],
    ["pdf to png", "pdf-to-jpg"],
    ["pdf to image", "pdf-to-jpg"],
    ["compress", "compress-image"],
    ["reduce photo size", "compress-image"],
    ["shrink picture", "compress-image"],
    ["compres image", "compress-image"],
    ["20kb", "compress-image-to-20kb"],
    ["photo 50 kb", "compress-image-to-50kb"],
    ["compress image to 100kb", "compress-image-to-100kb"],
    ["ছবি ২০ কেবি", "compress-image-to-20kb"],
    ["resize", "resize-image"],
    ["change image dimensions", "resize-image"],
    ["signature", "photo-signature-resizer"],
    ["job application photo", "photo-signature-resizer"],
    ["teletalk", "photo-signature-resizer"],
    ["png to jpg", "convert-image"],
    ["webp", "convert-image"],
    ["heic", "heic-to-jpg"],
    ["iphone photo", "heic-to-jpg"],
    ["exif", "remove-image-metadata"],
    ["remove location from photo", "remove-image-metadata"],
    ["qr", "qr-code-generator"],
    ["qr code maker", "qr-code-generator"],
    ["bijoy", "bijoy-to-unicode"],
    ["sutonny", "bijoy-to-unicode"],
    ["বিজয়", "bijoy-to-unicode"],
    ["ansi to unicode", "bijoy-to-unicode"],
    ["number to words", "number-to-bangla-words"],
    ["taka in words", "number-to-bangla-words"],
    ["টাকা কথায়", "number-to-bangla-words"],
    ["bangla date", "bangla-date-converter"],
    ["bengali calendar", "bangla-date-converter"],
    ["json", "json-formatter"],
    ["pretty print json", "json-formatter"],
    ["base 64", "base64-encode-decode"],
    ["decode", "base64-encode-decode"],
    ["password", "password-generator"],
    ["pasword", "password-generator"],
    ["random password generator", "password-generator"],
    ["word count", "word-counter"],
    ["character counter", "word-counter"],
    ["শব্দ গণনা", "word-counter"],
    ["age", "age-calculator"],
    ["date of birth", "age-calculator"],
    ["how old am i", "age-calculator"],
  ])("%s finds %s", (query, slug) => {
    expect(top(query)).toBe(slug);
  });
});

describe("result lists", () => {
  it("lists every PDF tool for a category word", () => {
    expect(slugs("pdf").slice(0, 4).sort()).toEqual(["jpg-to-pdf", "merge-pdf", "pdf-to-jpg", "split-pdf"]);
  });

  it("puts the parent tool before its size pages", () => {
    expect(slugs("compress image").slice(0, 2)).toEqual(["compress-image", "compress-image-to-20kb"]);
  });

  it("falls back to the closest tools when nothing matches every word", () => {
    expect(slugs("rotate pdf")).toContain("merge-pdf");
  });

  it("returns nothing for gibberish or an empty query", () => {
    expect(search("xyzzyq")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("limits the number of results", () => {
    expect(search("image", 5)).toHaveLength(5);
  });
});
