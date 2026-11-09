import { unzlibSync, zlibSync } from "fflate";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { makeEncryptedPdf, makePdf } from "../../../tests/fixtures/pdf";
import { type Encode, LEVELS, compressPdf, compressedName, readLevel, targetSize, unpredict } from "./compress";
import { savedPercent } from "./tool";

// Seeded noise, so pictures don't compress away and every run is the same.
function noise(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed;
  for (let i = 0; i < length; i++) out[i] = (state = (state * 1103515245 + 12345) % 2147483648) >> 16;
  return out;
}

interface ImageSpec {
  width?: number;
  height?: number;
  entries?: Record<string, unknown>;
  // Raw pixel bytes; Flate-compressed unless `jpeg` is set.
  pixels?: Uint8Array;
  jpeg?: Uint8Array;
}

// A one-page A4 PDF showing each image full page, the way a scan is drawn.
async function imagePdf(images: ImageSpec[]): Promise<{ bytes: Uint8Array; refs: PDFRef[] }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const refs = images.map((spec) => {
    const width = spec.width ?? 300;
    const height = spec.height ?? 400;
    const dict = { Type: "XObject", Subtype: "Image", Width: width, Height: height, BitsPerComponent: 8, ColorSpace: "DeviceRGB", ...spec.entries };
    const stream = spec.jpeg
      ? doc.context.stream(spec.jpeg, { ...dict, Filter: "DCTDecode" })
      : doc.context.stream(zlibSync(spec.pixels ?? noise(width * height * 3)), { ...dict, Filter: "FlateDecode" });
    const ref = doc.context.register(stream);
    const name = page.node.newXObject("Im", ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(595, 0, 0, 842, 0, 0), drawObject(name), popGraphicsState());
    return ref;
  });
  return { bytes: await doc.save({ useObjectStreams: false }), refs };
}

// Stands in for the browser's JPEG encoder: records what it was asked and returns a tiny "JPEG".
function fakeEncoder(size = 500) {
  const calls: Parameters<Encode>[] = [];
  const encode: Encode = async (...args) => {
    calls.push(args);
    return new Uint8Array(size).fill(7);
  };
  return { encode, calls };
}

async function streamAt(bytes: Uint8Array, ref: PDFRef) {
  const doc = await PDFDocument.load(bytes);
  // Saving renumbers nothing, but object streams may move things, so look the image up from the page.
  const xObjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  const found = xObjects?.values().map((value) => doc.context.lookup(value)) ?? [];
  return { doc, stream: (doc.context.lookup(ref) ?? found[0]) as PDFRawStream, all: found as PDFRawStream[] };
}

describe("readLevel", () => {
  it("starts on Recommended, like other PDF tools", () => {
    expect(readLevel("")).toBe("recommended");
    expect(readLevel("nonsense")).toBe("recommended");
    expect(readLevel("extreme")).toBe("extreme");
    expect(readLevel("less")).toBe("less");
  });

  it("gives Extreme the lowest resolution and quality", () => {
    expect(LEVELS.extreme.dpi).toBeLessThan(LEVELS.recommended.dpi);
    expect(LEVELS.recommended.dpi).toBeLessThan(LEVELS.less.dpi);
    expect(LEVELS.extreme.quality).toBeLessThan(LEVELS.recommended.quality);
    expect(LEVELS.recommended.quality).toBeLessThan(LEVELS.less.quality);
  });
});

describe("targetSize", () => {
  it("shrinks a picture to the resolution of the longest page side", () => {
    // An A4 page is 842 points (11.7 inches) tall: at 72 dpi, 842 pixels.
    expect(targetSize(3000, 4000, 842, 72)).toEqual({ width: 632, height: 842 });
    expect(targetSize(4000, 3000, 842, 144)).toEqual({ width: 1684, height: 1263 });
  });

  it("never enlarges a picture", () => {
    expect(targetSize(400, 300, 842, 144)).toEqual({ width: 400, height: 300 });
  });
});

describe("unpredict", () => {
  // Filters rows the way a PNG encoder does, to check they're undone exactly.
  function predict(raw: Uint8Array, columns: number, colors: number, types: number[]): Uint8Array {
    const row = columns * colors;
    const rows = raw.length / row;
    const out = new Uint8Array(rows * (row + 1));
    for (let y = 0; y < rows; y++) {
      const type = types[y % types.length];
      out[y * (row + 1)] = type;
      for (let x = 0; x < row; x++) {
        const at = y * row + x;
        const left = x >= colors ? raw[at - colors] : 0;
        const up = y ? raw[at - row] : 0;
        const upLeft = y && x >= colors ? raw[at - row - colors] : 0;
        const paeth = () => {
          const p = left + up - upLeft;
          const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
          return a <= b && a <= c ? left : b <= c ? up : upLeft;
        };
        const guess = [0, left, up, (left + up) >> 1, paeth()][type];
        out[y * (row + 1) + 1 + x] = (raw[at] - guess) & 255;
      }
    }
    return out;
  }

  it.each([0, 1, 2, 3, 4])("undoes PNG filter type %i", (type) => {
    const raw = noise(5 * 4 * 3, type + 3);
    expect(unpredict(predict(raw, 5, 3, [type]), 5, 3)).toEqual(raw);
  });

  it("undoes rows that each use a different filter", () => {
    const raw = noise(7 * 6, 9);
    expect(unpredict(predict(raw, 7, 1, [4, 0, 1, 3, 2, 4]), 7, 1)).toEqual(raw);
  });

  it("gives up on an unknown filter type", () => {
    expect(unpredict(new Uint8Array([9, 1, 2, 3]), 3, 1)).toBeNull();
  });
});

describe("compressPdf", () => {
  it("turns a large photo into a smaller JPEG at the level's resolution", async () => {
    const { bytes, refs } = await imagePdf([{ width: 2000, height: 2800 }]);
    const { encode, calls } = fakeEncoder();
    const result = await compressPdf(bytes, "extreme", encode);
    expect(result.smaller).toBe(true);
    expect(result.bytes.length).toBeLessThan(bytes.length / 10);
    expect(calls).toHaveLength(1);
    const [source, from, to, quality] = calls[0];
    expect(source.kind).toBe("pixels");
    expect(source.kind === "pixels" && source.rgba.length).toBe(2000 * 2800 * 4);
    expect(from).toEqual({ width: 2000, height: 2800 });
    expect(to).toEqual({ width: 601, height: 842 });
    expect(quality).toBe(LEVELS.extreme.quality);
    const { doc, stream } = await streamAt(result.bytes, refs[0]);
    expect(stream.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
    expect(stream.dict.get(PDFName.of("ColorSpace"))).toBe(PDFName.of("DeviceRGB"));
    expect(stream.dict.get(PDFName.of("Width"))).toEqual(PDFNumber.of(601));
    expect(stream.dict.get(PDFName.of("Height"))).toEqual(PDFNumber.of(842));
    expect(stream.getContents()).toHaveLength(500);
    expect(doc.getPageCount()).toBe(1);
  });

  it("passes JPEG photos to the encoder as they are", async () => {
    const jpeg = noise(40_000, 5);
    const { bytes } = await imagePdf([{ width: 1200, height: 1600, jpeg }]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "recommended", encode);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({ kind: "jpeg", bytes: jpeg });
    expect(calls[0][2]).toEqual({ width: 1200, height: 1600 });
  });

  it("spreads grey pixels into red, green and blue", async () => {
    const pixels = noise(300 * 400, 2);
    const { bytes } = await imagePdf([{ pixels, entries: { ColorSpace: "DeviceGray" } }]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "recommended", encode);
    const source = calls[0][0];
    expect(source.kind === "pixels" && Array.from(source.rgba.slice(0, 8))).toEqual([pixels[0], pixels[0], pixels[0], 255, pixels[1], pixels[1], pixels[1], 255]);
  });

  it("reads pictures stored with PNG predictors", async () => {
    const raw = noise(300 * 400 * 3, 4);
    const filtered = new Uint8Array(400 * (300 * 3 + 1));
    for (let y = 0; y < 400; y++) filtered.set(raw.subarray(y * 900, (y + 1) * 900), y * 901 + 1);
    const { bytes } = await imagePdf([{ pixels: filtered, entries: { DecodeParms: { Predictor: 15, Colors: 3, Columns: 300, BitsPerComponent: 8 } } }]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "recommended", encode);
    const source = calls[0][0];
    expect(source.kind === "pixels" && Array.from(source.rgba.slice(0, 4))).toEqual([raw[0], raw[1], raw[2], 255]);
  });

  it("keeps a picture when the new one wouldn't be smaller", async () => {
    const { bytes, refs } = await imagePdf([{}]);
    const { encode } = fakeEncoder(1_000_000);
    const result = await compressPdf(bytes, "extreme", encode);
    const { stream } = await streamAt(result.bytes, refs[0]);
    expect(stream.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
  });

  it("keeps a picture the encoder couldn't handle", async () => {
    const { bytes, refs } = await imagePdf([{}]);
    const result = await compressPdf(bytes, "extreme", async () => null);
    const { stream } = await streamAt(result.bytes, refs[0]);
    expect(stream.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
  });

  it.each([
    ["CMYK", { ColorSpace: "DeviceCMYK" }],
    ["indexed colours", { ColorSpace: ["Indexed", "DeviceRGB", 1, "<000000FFFFFF>"] }],
    ["1-bit pictures", { BitsPerComponent: 1 }],
    ["stencil masks", { ImageMask: true }],
    ["a Decode array", { Decode: [1, 0, 1, 0, 1, 0] }],
    ["a colour-key mask", { Mask: [0, 10, 0, 10, 0, 10] }],
  ])("leaves pictures with %s alone", async (_, entries) => {
    const { bytes } = await imagePdf([{ entries }]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "extreme", encode);
    expect(calls).toHaveLength(0);
  });

  it("leaves small pictures alone", async () => {
    const { bytes } = await imagePdf([{ width: 40, height: 40 }]);
    const { encode, calls } = fakeEncoder();
    await compressPdf(bytes, "extreme", encode);
    expect(calls).toHaveLength(0);
  });

  it("keeps transparency: the soft mask isn't turned into a JPEG", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const mask = doc.context.register(
      doc.context.stream(zlibSync(noise(300 * 400, 8)), { Type: "XObject", Subtype: "Image", Width: 300, Height: 400, BitsPerComponent: 8, ColorSpace: "DeviceGray", Filter: "FlateDecode" }),
    );
    const image = doc.context.register(
      doc.context.stream(zlibSync(noise(300 * 400 * 3)), { Type: "XObject", Subtype: "Image", Width: 300, Height: 400, BitsPerComponent: 8, ColorSpace: "DeviceRGB", Filter: "FlateDecode", SMask: mask }),
    );
    page.pushOperators(concatTransformationMatrix(595, 0, 0, 842, 0, 0), drawObject(page.node.newXObject("Im", image)));
    const { encode, calls } = fakeEncoder();
    const result = await compressPdf(await doc.save(), "extreme", encode);
    expect(calls).toHaveLength(1);
    const out = await PDFDocument.load(result.bytes);
    const picture = out.context.lookup(image) as PDFRawStream;
    expect(picture.dict.get(PDFName.of("SMask"))).toBeInstanceOf(PDFRef);
    const softMask = out.context.lookup(picture.dict.get(PDFName.of("SMask")) as PDFRef) as PDFRawStream;
    expect(softMask.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
  });

  it("compresses streams that were stored without compression", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const drawing = new TextEncoder().encode("0 0 1 rg 10 10 50 50 re f\n".repeat(400));
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj({}), drawing));
    page.node.set(PDFName.of("Contents"), ref);
    const bytes = await doc.save({ useObjectStreams: false });
    const result = await compressPdf(bytes, "recommended", fakeEncoder().encode);
    expect(result.smaller).toBe(true);
    const out = await PDFDocument.load(result.bytes);
    const stream = out.context.lookup(ref) as PDFRawStream;
    expect(stream.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("FlateDecode"));
    expect(unzlibSync(stream.getContents())).toEqual(drawing);
  });

  it("drops objects nothing points to", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const orphan = doc.context.register(doc.context.stream(noise(30_000), {}));
    const bytes = await doc.save({ useObjectStreams: false });
    const result = await compressPdf(bytes, "recommended", fakeEncoder().encode);
    expect(result.bytes.length).toBeLessThan(bytes.length - 25_000);
    const out = await PDFDocument.load(result.bytes);
    expect(out.context.lookup(orphan)).toBeUndefined();
    expect(out.getPageCount()).toBe(1);
  });

  it("keeps bookmarks, links and the page tree reachable", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([300, 200]);
    const outline = doc.context.register(doc.context.obj({ Type: "Outlines", Count: 0 }));
    doc.catalog.set(PDFName.of("Outlines"), outline);
    doc.setTitle("Annual report");
    const result = await compressPdf(await doc.save({ useObjectStreams: false }), "extreme", fakeEncoder().encode);
    const out = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(out.getPages().map((page) => page.getWidth())).toEqual([200, 300]);
    expect(out.catalog.lookup(PDFName.of("Outlines"), PDFDict).get(PDFName.of("Type"))).toBe(PDFName.of("Outlines"));
    expect(out.getTitle()).toBe("Annual report");
  });

  it("gives the original back when it can't be made smaller", async () => {
    const bytes = await makePdf([200]);
    const tight = await (await PDFDocument.load(bytes)).save();
    const result = await compressPdf(tight, "extreme", fakeEncoder().encode);
    if (!result.smaller) expect(result.bytes).toBe(tight);
    expect(result.bytes.length).toBeLessThanOrEqual(tight.length);
  });

  it("reports progress through the pictures", async () => {
    const { bytes } = await imagePdf([{}, {}]);
    const seen: number[] = [];
    await compressPdf(bytes, "recommended", fakeEncoder().encode, (fraction) => seen.push(fraction));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBe(1);
  });

  it("explains password-protected and damaged files", async () => {
    await expect(compressPdf(await makeEncryptedPdf(), "recommended", fakeEncoder().encode)).rejects.toMatchObject({ code: "encrypted" });
    await expect(compressPdf(new TextEncoder().encode("not a pdf"), "recommended", fakeEncoder().encode)).rejects.toMatchObject({ code: "unreadable" });
  });

  it("handles an image array colour space based on an ICC profile", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const profile = doc.context.register(doc.context.stream(noise(200), { N: 3 }));
    const colorSpace = PDFArray.withContext(doc.context);
    colorSpace.push(PDFName.of("ICCBased"));
    colorSpace.push(profile);
    const image = doc.context.register(
      doc.context.stream(zlibSync(noise(300 * 400 * 3)), { Type: "XObject", Subtype: "Image", Width: 300, Height: 400, BitsPerComponent: 8, ColorSpace: colorSpace, Filter: "FlateDecode" }),
    );
    page.pushOperators(concatTransformationMatrix(595, 0, 0, 842, 0, 0), drawObject(page.node.newXObject("Im", image)));
    const { encode, calls } = fakeEncoder();
    await compressPdf(await doc.save(), "recommended", encode);
    expect(calls).toHaveLength(1);
  });
});

describe("compressedName", () => {
  it.each([
    ["report.pdf", "report_compressed.pdf"],
    ["Scan.PDF", "Scan_compressed.pdf"],
    ["১৯৭১.pdf", "১৯৭১_compressed.pdf"],
    [".pdf", "document_compressed.pdf"],
  ])("names %j like other PDF tools do", (original, name) => {
    expect(compressedName(original)).toBe(name);
  });
});

describe("savedPercent", () => {
  it.each([
    [1000, 500, 50],
    [1000, 999, 1],
    [1000, 1, 99],
    [1000, 1000, 0],
    [1000, 1200, 0],
  ])("%i bytes to %i is %i%% smaller", (before, after, percent) => {
    expect(savedPercent(before, after)).toBe(percent);
  });
});
