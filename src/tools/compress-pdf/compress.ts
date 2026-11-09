import { unzlibSync, zlibSync } from "fflate";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFContext, type PDFObject } from "pdf-lib";
import { JobError } from "../../lib/worker/host";

export type Level = "extreme" | "recommended" | "less";

// The most detail a picture keeps for a full page, and the JPEG quality it's saved at.
export const LEVELS: Record<Level, { dpi: number; quality: number }> = {
  extreme: { dpi: 72, quality: 0.5 },
  recommended: { dpi: 144, quality: 0.7 },
  less: { dpi: 220, quality: 0.85 },
};

// Pictures smaller than this aren't worth the loss in quality.
const MIN_IMAGE_BYTES = 8 * 1024;

export interface Size {
  width: number;
  height: number;
}

// What the encoder gets: a JPEG as stored in the PDF, or pixels already unpacked to RGBA.
export type Source = { kind: "jpeg"; bytes: Uint8Array } | { kind: "pixels"; rgba: Uint8ClampedArray };

// Makes a JPEG of `to` size, or null when the picture can't be read. The browser's canvas does this in the worker.
export type Encode = (source: Source, from: Size, to: Size, quality: number) => Promise<Uint8Array | null>;

export class CompressError extends JobError {
  constructor(code: "encrypted" | "unreadable") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

export function readLevel(text: string): Level {
  return text === "extreme" || text === "less" ? text : "recommended";
}

// Shrinks a picture so its longer side holds `dpi` pixels per inch of the longest page side. Never enlarges.
export function targetSize(width: number, height: number, longestPage: number, dpi: number): Size {
  const most = Math.max(1, Math.round((longestPage / 72) * dpi));
  const longest = Math.max(width, height);
  if (longest <= most) return { width, height };
  const scale = most / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Undoes PNG row filters (PDF predictors 10 to 15), with one byte per sample. Null for a filter it doesn't know.
export function unpredict(data: Uint8Array, columns: number, colors: number): Uint8Array | null {
  const row = columns * colors;
  const rows = Math.floor(data.length / (row + 1));
  const out = new Uint8Array(rows * row);
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)];
    const from = y * (row + 1) + 1;
    const at = y * row;
    for (let x = 0; x < row; x++) {
      const left = x >= colors ? out[at + x - colors] : 0;
      const up = y ? out[at + x - row] : 0;
      const upLeft = y && x >= colors ? out[at + x - row - colors] : 0;
      let guess: number;
      if (type === 0) guess = 0;
      else if (type === 1) guess = left;
      else if (type === 2) guess = up;
      else if (type === 3) guess = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - upLeft;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        guess = a <= b && a <= c ? left : b <= c ? up : upLeft;
      } else return null;
      out[at + x] = (data[from + x] + guess) & 255;
    }
  }
  return out;
}

function toRgba(samples: Uint8Array, pixels: number, colors: 1 | 3): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels * 4);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const from = pixel * colors;
    out[pixel * 4] = samples[from];
    out[pixel * 4 + 1] = samples[colors === 3 ? from + 1 : from];
    out[pixel * 4 + 2] = samples[colors === 3 ? from + 2 : from];
    out[pixel * 4 + 3] = 255;
  }
  return out;
}

const name = (value: string) => PDFName.of(value);

// The number of colour channels, for the colour spaces a JPEG can stand in for. Null for anything else.
function channels(context: PDFContext, value: PDFObject | undefined): 1 | 3 | null {
  const space = value instanceof PDFRef ? context.lookup(value) : value;
  if (space === name("DeviceRGB") || space === name("CalRGB")) return 3;
  if (space === name("DeviceGray") || space === name("CalGray")) return 1;
  if (space instanceof PDFArray && space.size() === 2 && space.lookup(0) === name("ICCBased")) {
    const profile = space.lookup(1);
    const count = profile instanceof PDFStream ? profile.dict.lookup(name("N")) : undefined;
    if (count instanceof PDFNumber && (count.asNumber() === 1 || count.asNumber() === 3)) return count.asNumber() as 1 | 3;
  }
  if (space instanceof PDFArray && space.size() === 2 && (space.lookup(0) === name("CalRGB") || space.lookup(0) === name("CalGray"))) {
    return space.lookup(0) === name("CalRGB") ? 3 : 1;
  }
  return null;
}

function single(context: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  const found = value instanceof PDFRef ? context.lookup(value) : value;
  return found instanceof PDFArray && found.size() === 1 ? found.lookup(0) : found;
}

interface Candidate {
  ref: PDFRef;
  stream: PDFRawStream;
  width: number;
  height: number;
  colors: 1 | 3;
  jpeg: boolean;
}

// The pictures worth recompressing: 8-bit RGB or grey, stored as JPEG or Flate, not used as a mask.
function candidates(context: PDFContext): Candidate[] {
  const images = context.enumerateIndirectObjects().filter(
    (entry): entry is [PDFRef, PDFRawStream] => entry[1] instanceof PDFRawStream && entry[1].dict.lookup(name("Subtype")) === name("Image"),
  );
  const masks = new Set<string>();
  for (const [, stream] of images) {
    for (const key of ["SMask", "Mask"]) {
      const ref = stream.dict.get(name(key));
      if (ref instanceof PDFRef) masks.add(ref.tag);
    }
  }
  const found: Candidate[] = [];
  for (const [ref, stream] of images) {
    const dict = stream.dict;
    if (masks.has(ref.tag) || stream.getContentsSize() < MIN_IMAGE_BYTES) continue;
    if (dict.lookup(name("ImageMask")) === PDFBool.True || dict.has(name("Decode")) || dict.lookup(name("Mask")) instanceof PDFArray) continue;
    const bits = dict.lookup(name("BitsPerComponent"));
    if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8) continue;
    const width = dict.lookup(name("Width"));
    const height = dict.lookup(name("Height"));
    if (!(width instanceof PDFNumber) || !(height instanceof PDFNumber)) continue;
    const colors = channels(context, dict.get(name("ColorSpace")));
    const filter = single(context, dict.get(name("Filter")));
    if (!colors || (filter !== name("DCTDecode") && filter !== name("FlateDecode"))) continue;
    found.push({ ref, stream, width: width.asNumber(), height: height.asNumber(), colors, jpeg: filter === name("DCTDecode") });
  }
  return found;
}

// The picture as the encoder wants it, or null when it's stored in a way this tool doesn't read.
function sourceFor(context: PDFContext, image: Candidate): Source | null {
  if (image.jpeg) return { kind: "jpeg", bytes: image.stream.getContents() };
  let samples: Uint8Array;
  try {
    samples = unzlibSync(image.stream.getContents());
  } catch {
    return null;
  }
  const parms = single(context, image.stream.dict.get(name("DecodeParms")));
  const predictor = parms instanceof PDFDict ? parms.lookup(name("Predictor")) : undefined;
  if (predictor instanceof PDFNumber && predictor.asNumber() >= 10) {
    const unpacked = unpredict(samples, image.width, image.colors);
    if (!unpacked) return null;
    samples = unpacked;
  } else if (predictor instanceof PDFNumber && predictor.asNumber() !== 1) return null;
  const pixels = image.width * image.height;
  if (samples.length < pixels * image.colors) return null;
  return { kind: "pixels", rgba: toRgba(samples, pixels, image.colors) };
}

function replaceImage(context: PDFContext, image: Candidate, jpeg: Uint8Array, size: Size) {
  const dict = image.stream.dict.clone(context);
  for (const key of ["DecodeParms", "Length"]) dict.delete(name(key));
  dict.set(name("Filter"), name("DCTDecode"));
  dict.set(name("ColorSpace"), name("DeviceRGB"));
  dict.set(name("BitsPerComponent"), PDFNumber.of(8));
  dict.set(name("Width"), PDFNumber.of(size.width));
  dict.set(name("Height"), PDFNumber.of(size.height));
  context.assign(image.ref, PDFRawStream.of(dict, jpeg));
}

// Streams saved with no compression at all, like drawings from some scanners and older tools, get Flate.
function compressPlainStreams(context: PDFContext) {
  for (const [ref, stream] of context.enumerateIndirectObjects()) {
    if (!(stream instanceof PDFRawStream) || stream.dict.has(name("Filter"))) continue;
    const contents = stream.getContents();
    const packed = zlibSync(contents, { level: 9 });
    if (packed.length >= contents.length) continue;
    const dict = stream.dict.clone(context);
    dict.delete(name("Length"));
    dict.delete(name("DecodeParms"));
    dict.set(name("Filter"), name("FlateDecode"));
    context.assign(ref, PDFRawStream.of(dict, packed));
  }
}

// Earlier edits can leave objects nothing points to any more. Keep only what the document can reach.
function dropOrphans(context: PDFContext) {
  const reached = new Set<string>();
  const { Root, Info, Encrypt } = context.trailerInfo;
  const pending: (PDFObject | undefined)[] = [Root, Info, Encrypt];
  while (pending.length) {
    const object = pending.pop();
    if (object instanceof PDFRef) {
      if (reached.has(object.tag)) continue;
      reached.add(object.tag);
      pending.push(context.lookup(object));
    } else if (object instanceof PDFDict) pending.push(...object.values());
    else if (object instanceof PDFArray) pending.push(...object.asArray());
    else if (object instanceof PDFStream) pending.push(object.dict);
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.tag)) context.delete(ref);
  }
}

export async function compressPdf(
  bytes: Uint8Array,
  level: Level,
  encode: Encode,
  onProgress: (fraction: number) => void = () => {},
): Promise<{ bytes: Uint8Array; smaller: boolean }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new CompressError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  const context = doc.context;
  const { dpi, quality } = LEVELS[level];
  const longestPage = Math.max(...doc.getPages().map((page) => Math.max(page.getWidth(), page.getHeight())), 1);
  const images = candidates(context);
  for (const [index, image] of images.entries()) {
    const source = sourceFor(context, image);
    if (source) {
      const from = { width: image.width, height: image.height };
      const to = targetSize(image.width, image.height, longestPage, dpi);
      const jpeg = await encode(source, from, to, quality);
      if (jpeg && jpeg.length < image.stream.getContentsSize()) replaceImage(context, image, jpeg, to);
    }
    onProgress(((index + 1) / images.length) * 0.9);
  }
  compressPlainStreams(context);
  dropOrphans(context);
  const out = await doc.save({ useObjectStreams: true });
  onProgress(1);
  return out.length < bytes.length ? { bytes: out, smaller: true } : { bytes, smaller: false };
}

// Like most PDF tools: "report.pdf" becomes "report_compressed.pdf".
export function compressedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_compressed.pdf`;
}
