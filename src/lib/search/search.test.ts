import { describe, expect, it } from "vitest";
import { buildSearchEntries } from "./entries";
import { createSearch, normalize } from "./search";

const search = createSearch(buildSearchEntries());
const top = (query: string) => search(query)[0]?.slug;
const slugs = (query: string) => search(query).map((r) => r.slug);

describe("normalize", () => {
  it("lowercases, strips punctuation and splits letters from numbers", () => {
    expect(normalize("Merge-PDF to 20KB!")).toBe("merge pdf to 20 kb");
    expect(normalize("base64")).toBe("base 64");
  });

  it("keeps Bangla letters and vowel signs, and reads Bangla digits", () => {
    expect(normalize("ছবি ২০ কেবি")).toBe("ছবি 20 কেবি");
    expect(normalize("পিডিএফ")).toBe("পিডিএফ");
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
    ["পিডিএফ যুক্ত", "merge-pdf"],
    ["split", "split-pdf"],
    ["split pdf", "split-pdf"],
    ["separate pdf", "split-pdf"],
    ["divide a pdf", "split-pdf"],
    ["splt pdf", "split-pdf"],
    ["পৃষ্ঠা মুছুন", "remove-pdf-pages"],
    ["পৃষ্ঠা আলাদা করুন", "extract-pdf-pages"],
    ["jpg to pdf", "jpg-to-pdf"],
    ["jpeg to pdf", "jpg-to-pdf"],
    ["png to pdf", "png-to-pdf"],
    ["webp to pdf", "webp-to-pdf"],
    ["heic to pdf", "heic-to-pdf"],
    ["iphone photo to pdf", "heic-to-pdf"],
    ["image to pdf", "image-to-pdf"],
    ["pictures to pdf", "image-to-pdf"],
    ["photo to pdf", "image-to-pdf"],
    ["scan to pdf", "image-to-pdf"],
    ["pdf to jpg", "pdf-to-jpg"],
    ["pdf to png", "pdf-to-png"],
    ["pdf to image", "pdf-to-jpg"],
    ["save pdf as picture", "pdf-to-jpg"],
    ["organize", "organize-pdf"],
    ["organise pdf", "organize-pdf"],
    ["reorder pages", "organize-pdf"],
    ["rearrange pdf", "organize-pdf"],
    ["পৃষ্ঠা সাজান", "organize-pdf"],
    ["rotate", "rotate-pdf"],
    ["rotate pdf", "rotate-pdf"],
    ["turn pdf pages", "rotate-pdf"],
    ["sideways pdf", "rotate-pdf"],
    ["rotat pdf", "rotate-pdf"],
    ["crop pdf", "crop-pdf"],
    ["password protect pdf", "protect-pdf"],
    ["encrypt pdf", "protect-pdf"],
    ["remove pdf password", "unlock-pdf"],
    ["unlock pdf", "unlock-pdf"],
    ["repair pdf", "repair-pdf"],
    ["corrupt pdf", "repair-pdf"],
    ["scan document", "scan-to-pdf"],
    ["document scanner", "scan-to-pdf"],
    ["trim pdf margins", "crop-pdf"],
    ["remove pages", "remove-pdf-pages"],
    ["delete pdf pages", "remove-pdf-pages"],
    ["delete page from pdf", "remove-pdf-pages"],
    ["extract pages", "extract-pdf-pages"],
    ["extract pdf pages", "extract-pdf-pages"],
    ["pull pages out", "extract-pdf-pages"],
    ["page numbers", "add-page-numbers"],
    ["number pdf pages", "add-page-numbers"],
    ["paginate", "add-page-numbers"],
    ["পৃষ্ঠা নম্বর", "add-page-numbers"],
    ["watermark", "add-watermark"],
    ["watermark pdf", "add-watermark"],
    ["stamp confidential", "add-watermark"],
    ["watermrk", "add-watermark"],
    ["জলছাপ", "add-watermark"],
    ["compress pdf", "compress-pdf"],
    ["sign pdf", "sign-pdf"],
    ["add signature to pdf", "sign-pdf"],
    ["esign", "sign-pdf"],
    ["electronic signature", "sign-pdf"],
    ["draw signature", "sign-pdf"],
    ["add initials", "sign-pdf"],
    ["পিডিএফে স্বাক্ষর", "sign-pdf"],
    ["reduce pdf size", "compress-pdf"],
    ["make pdf smaller", "compress-pdf"],
    ["compres pdf", "compress-pdf"],
    ["পিডিএফ ছোট করুন", "compress-pdf"],
  ])("%s finds %s", (query, slug) => {
    expect(top(query)).toBe(slug);
  });
});

describe("result lists", () => {
  it("lists every PDF tool for the category word", () => {
    const all = search("pdf", 20).map((r) => r.slug);
    expect(all).toHaveLength(19);
    expect(all[0]).toBe("merge-pdf");
  });

  it("keeps phrase order, so the two conversions don't swap", () => {
    expect(top("jpg to pdf")).toBe("jpg-to-pdf");
    expect(top("pdf to jpg")).toBe("pdf-to-jpg");
  });

  it("falls back to the closest tools when nothing matches every word", () => {
    expect(slugs("merge and rotate pdf")).toEqual(expect.arrayContaining(["merge-pdf", "rotate-pdf"]));
  });

  it("returns nothing for gibberish or an empty query", () => {
    expect(search("xyzzyq")).toEqual([]);
    expect(search("   ")).toEqual([]);
  });

  it("limits the number of results", () => {
    expect(search("pdf", 5)).toHaveLength(5);
  });
});
