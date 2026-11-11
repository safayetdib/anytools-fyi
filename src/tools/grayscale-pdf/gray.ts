import { unzlibSync, zlibSync } from "fflate";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { JobError } from "../../lib/worker/host";
import { unpredict } from "../compress-pdf/compress";

// Turns colour into grey everywhere in a PDF without turning pages into pictures: the colour commands in every drawing
// are rewritten, and pictures are converted. Text stays text, so it stays sharp, small and searchable.

// Re-encodes a JPEG in grey, or null when it can't. Pictures need a canvas, so the worker brings its own.
export type GrayJpeg = (jpeg: Uint8Array) => Promise<Uint8Array | null>;

export class GrayError extends JobError {
  constructor(code: "encrypted" | "unreadable") {
    super(code);
  }
}

const name = (value: string) => PDFName.of(value);

// How bright a colour looks, from 0 to 1, as the eye sees it (ITU-R BT.601 weights, used by most PDF tools).
export const lightness = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
export const cmykLightness = (c: number, m: number, y: number, k: number) => lightness((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
const round = (value: number) => String(Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000);

// What a colour space's values mean for grey: how many there are, and how to turn them into one.
type Space = { count: number; gray: (values: number[]) => number } | null;

const SPACES: Record<string, Space> = {
  DeviceGray: { count: 1, gray: ([v]) => v },
  CalGray: { count: 1, gray: ([v]) => v },
  DeviceRGB: { count: 3, gray: ([r, g, b]) => lightness(r, g, b) },
  CalRGB: { count: 3, gray: ([r, g, b]) => lightness(r, g, b) },
  DeviceCMYK: { count: 4, gray: ([c, m, y, k]) => cmykLightness(c, m, y, k) },
};

// A colour space from a page's or drawing's resources: null when it stays as it is (patterns, palettes, unknown).
function spaceOf(context: PDFContext, value: PDFObject | undefined): Space {
  const space = value instanceof PDFRef ? context.lookup(value) : value;
  if (space instanceof PDFName) return SPACES[space.decodeText()] ?? null;
  if (!(space instanceof PDFArray) || space.size() === 0) return null;
  const kind = space.lookup(0);
  if (!(kind instanceof PDFName)) return null;
  const family = kind.decodeText();
  if (family === "ICCBased") {
    const profile = space.lookup(1);
    const count = profile instanceof PDFStream ? profile.dict.lookup(name("N")) : undefined;
    const n = count instanceof PDFNumber ? count.asNumber() : 0;
    return n === 1 ? SPACES.DeviceGray : n === 3 ? SPACES.DeviceRGB : n === 4 ? SPACES.DeviceCMYK : null;
  }
  if (family === "CalRGB" || family === "CalGray") return SPACES[family];
  // A spot ink: no ink is white, full ink is dark.
  if (family === "Separation") return { count: 1, gray: ([tint]) => 1 - tint };
  if (family === "DeviceN") {
    const inks = space.lookup(1);
    const count = inks instanceof PDFArray ? inks.size() : 1;
    return { count, gray: (values) => 1 - Math.min(1, values.reduce((sum, value) => sum + value, 0)) };
  }
  if (family === "Lab") return { count: 3, gray: ([l]) => l / 100 };
  return null;
}

type Token = { kind: "operator"; text: string } | { kind: "operand"; text: string };

// Splits a drawing into operands and operators, keeping each piece's text exactly, so untouched parts are copied
// as they were. Strings, names, arrays and dictionaries are single operands; inline pictures are kept whole.
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const space = /[\0\t\n\f\r ]/;
  const delimiter = /[()<>[\]{}/%\0\t\n\f\r ]/;
  let at = 0;
  const readUntilBalanced = (open: string, close: string) => {
    let depth = 0;
    const start = at;
    while (at < source.length) {
      const char = source[at];
      if (char === "(") {
        readString();
        continue;
      }
      // A hex string inside, such as <FEFF2002>, whose ">" could otherwise end a dictionary early.
      if (char === "<" && source[at + 1] !== "<") {
        const end = source.indexOf(">", at);
        at = end < 0 ? source.length : end + 1;
        continue;
      }
      if (source.startsWith(open, at)) {
        depth++;
        at += open.length;
        continue;
      }
      if (source.startsWith(close, at)) {
        depth--;
        at += close.length;
        if (depth === 0) return source.slice(start, at);
        continue;
      }
      at++;
    }
    return source.slice(start);
  };
  const readString = () => {
    const start = at;
    let depth = 0;
    while (at < source.length) {
      const char = source[at];
      if (char === "\\") at += 2;
      else {
        if (char === "(") depth++;
        else if (char === ")") depth--;
        at++;
        if (depth === 0) break;
      }
    }
    return source.slice(start, at);
  };
  while (at < source.length) {
    const char = source[at];
    if (space.test(char)) {
      at++;
      continue;
    }
    if (char === "%") {
      while (at < source.length && source[at] !== "\n" && source[at] !== "\r") at++;
      continue;
    }
    if (char === "(") tokens.push({ kind: "operand", text: readString() });
    else if (source.startsWith("<<", at)) tokens.push({ kind: "operand", text: readUntilBalanced("<<", ">>") });
    else if (char === "<") {
      const end = source.indexOf(">", at);
      tokens.push({ kind: "operand", text: source.slice(at, end < 0 ? source.length : end + 1) });
      at = end < 0 ? source.length : end + 1;
    } else if (char === "[") tokens.push({ kind: "operand", text: readUntilBalanced("[", "]") });
    else if (char === "/") {
      const start = at++;
      while (at < source.length && !delimiter.test(source[at])) at++;
      tokens.push({ kind: "operand", text: source.slice(start, at) });
    } else {
      const start = at;
      while (at < source.length && !delimiter.test(source[at])) at++;
      if (at === start) at++;
      const text = source.slice(start, at);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) || text === "true" || text === "false" || text === "null") tokens.push({ kind: "operand", text });
      else if (text === "BI") {
        // An inline picture runs to "EI" after its data, which can hold any bytes; it's kept as it is.
        const data = source.indexOf("ID", at);
        let end = data < 0 ? -1 : source.indexOf("EI", data + 3);
        while (end > 0 && !(space.test(source[end - 1]) && (end + 2 >= source.length || space.test(source[end + 2])))) end = source.indexOf("EI", end + 2);
        const stop = end < 0 ? source.length : end + 2;
        tokens.push({ kind: "operator", text: source.slice(start, stop) });
        at = stop;
      } else tokens.push({ kind: "operator", text });
    }
  }
  return tokens;
}

// Rewrites a drawing's colour commands in grey. `resources` holds its named colour spaces.
export function grayContent(source: string, context: PDFContext, resources: PDFDict | undefined): string {
  const named = resources?.lookup(name("ColorSpace"));
  const lookupSpace = (text: string): Space => {
    const key = text.slice(1);
    if (SPACES[key]) return SPACES[key];
    return named instanceof PDFDict ? spaceOf(context, named.get(name(key))) : null;
  };
  const out: string[] = [];
  let operands: string[] = [];
  // The colour spaces in use for filling and stroking, which give "sc" and "scn" their meaning.
  let fill: Space = SPACES.DeviceGray;
  let stroke: Space = SPACES.DeviceGray;
  const numbers = (count: number) => operands.slice(-count).map(Number);
  for (const token of tokenize(source)) {
    if (token.kind === "operand") {
      operands.push(token.text);
      continue;
    }
    const op = token.text;
    let replaced: string[] | null = null;
    if ((op === "rg" || op === "RG") && operands.length >= 3) {
      const [r, g, b] = numbers(3);
      replaced = [...operands.slice(0, -3), round(lightness(r, g, b)), op === "rg" ? "g" : "G"];
    } else if ((op === "k" || op === "K") && operands.length >= 4) {
      const [c, m, y, k] = numbers(4);
      replaced = [...operands.slice(0, -4), round(cmykLightness(c, m, y, k)), op === "k" ? "g" : "G"];
    } else if ((op === "cs" || op === "CS") && operands.length) {
      const space = lookupSpace(operands[operands.length - 1]);
      if (op === "cs") fill = space;
      else stroke = space;
      if (space) replaced = [...operands.slice(0, -1), "/DeviceGray", op];
    } else if (["sc", "scn", "SC", "SCN"].includes(op)) {
      const space = op === "sc" || op === "scn" ? fill : stroke;
      const values = operands.filter((operand) => !operand.startsWith("/")).map(Number);
      if (space && values.length >= space.count && !operands.some((operand) => operand.startsWith("/"))) {
        replaced = [round(space.gray(values.slice(-space.count))), op];
      }
    }
    out.push(...(replaced ?? [...operands, op]));
    operands = [];
  }
  out.push(...operands);
  return out.join(" ");
}

// Latin-1 both ways keeps every byte of a drawing as one character, so binary parts survive the round trip.
const toText = (bytes: Uint8Array) => {
  let text = "";
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return text;
};
const toBytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 255);

function contents(stream: PDFRawStream): Uint8Array | null {
  const filter = stream.dict.lookup(name("Filter"));
  const only = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
  if (only === undefined) return stream.getContents();
  if (only !== name("FlateDecode") || stream.dict.has(name("DecodeParms"))) return null;
  try {
    return unzlibSync(stream.getContents());
  } catch {
    return null;
  }
}

function rewriteStream(context: PDFContext, ref: PDFRef, stream: PDFRawStream, resources: PDFDict | undefined) {
  const source = contents(stream);
  if (!source) return;
  const gray = toBytes(grayContent(toText(source), context, resources));
  const dict = stream.dict.clone(context);
  dict.delete(name("Length"));
  dict.delete(name("DecodeParms"));
  dict.set(name("Filter"), name("FlateDecode"));
  context.assign(ref, PDFRawStream.of(dict, zlibSync(gray, { level: 9 })));
}

// A palette picture's colours, rewritten in grey: the picture itself doesn't change.
function grayPalette(context: PDFContext, space: PDFArray): boolean {
  const base = spaceOf(context, space.get(1));
  if (!base) return false;
  const table = space.lookup(3);
  let bytes: Uint8Array | null = null;
  if (table instanceof PDFString || table instanceof PDFHexString) bytes = table.asBytes();
  else if (table instanceof PDFRawStream) bytes = contents(table);
  if (!bytes) return false;
  const out = new Uint8Array(Math.floor(bytes.length / base.count) * 3);
  for (let index = 0; index * base.count < bytes.length - base.count + 1; index++) {
    const values = Array.from(bytes.subarray(index * base.count, (index + 1) * base.count), (value) => value / 255);
    const level = Math.round(base.gray(values) * 255);
    out.set([level, level, level], index * 3);
  }
  space.set(1, name("DeviceRGB"));
  space.set(3, PDFHexString.of(Array.from(out, (value) => value.toString(16).padStart(2, "0")).join("")));
  return true;
}

async function grayImage(context: PDFContext, ref: PDFRef, stream: PDFRawStream, grayJpeg: GrayJpeg) {
  const dict = stream.dict;
  if (dict.lookup(name("ImageMask")) === PDFBool.True) return;
  const colorSpace = dict.get(name("ColorSpace"));
  const resolved = colorSpace instanceof PDFRef ? context.lookup(colorSpace) : colorSpace;
  if (resolved instanceof PDFArray && resolved.lookup(0) === name("Indexed")) {
    grayPalette(context, resolved);
    return;
  }
  const space = spaceOf(context, colorSpace);
  if (!space || space.count === 1) return;
  const filter = dict.lookup(name("Filter"));
  const only = filter instanceof PDFArray && filter.size() === 1 ? filter.lookup(0) : filter;
  const bits = dict.lookup(name("BitsPerComponent"));
  const width = dict.lookup(name("Width"));
  const height = dict.lookup(name("Height"));
  if (!(bits instanceof PDFNumber) || bits.asNumber() !== 8 || !(width instanceof PDFNumber) || !(height instanceof PDFNumber)) return;
  if (dict.has(name("Decode"))) return;
  if (only === name("DCTDecode")) {
    const jpeg = await grayJpeg(stream.getContents());
    if (!jpeg) return;
    const next = dict.clone(context);
    next.delete(name("Length"));
    next.delete(name("DecodeParms"));
    next.set(name("ColorSpace"), name("DeviceRGB"));
    context.assign(ref, PDFRawStream.of(next, jpeg));
    return;
  }
  if (only !== name("FlateDecode") && only !== undefined) return;
  let samples: Uint8Array;
  try {
    samples = only === undefined ? stream.getContents() : unzlibSync(stream.getContents());
  } catch {
    return;
  }
  const parms = dict.lookup(name("DecodeParms"));
  const predictor = parms instanceof PDFDict ? parms.lookup(name("Predictor")) : undefined;
  if (predictor instanceof PDFNumber && predictor.asNumber() >= 10) {
    const unpacked = unpredict(samples, width.asNumber(), space.count);
    if (!unpacked) return;
    samples = unpacked;
  } else if (predictor instanceof PDFNumber && predictor.asNumber() !== 1) return;
  const pixels = width.asNumber() * height.asNumber();
  if (samples.length < pixels * space.count) return;
  // One grey value per pixel: a third or a quarter of the colour picture's size.
  const gray = new Uint8Array(pixels);
  const values = new Array<number>(space.count);
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let channel = 0; channel < space.count; channel++) values[channel] = samples[pixel * space.count + channel] / 255;
    gray[pixel] = Math.round(space.gray(values) * 255);
  }
  const next = dict.clone(context);
  next.delete(name("Length"));
  next.delete(name("DecodeParms"));
  next.set(name("Filter"), name("FlateDecode"));
  next.set(name("ColorSpace"), name("DeviceGray"));
  context.assign(ref, PDFRawStream.of(next, zlibSync(gray, { level: 9 })));
}

export async function grayscalePdf(bytes: Uint8Array, grayJpeg: GrayJpeg, onProgress: (fraction: number) => void = () => {}): Promise<Uint8Array> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new GrayError(/is encrypted/i.test(String((error as Error)?.message)) ? "encrypted" : "unreadable");
  }
  const context = document.context;
  // Each page's drawing, with the page's resources for its named colour spaces.
  for (const page of document.getPages()) {
    const resources = page.node.Resources();
    const list = page.node.get(name("Contents"));
    const refs = list instanceof PDFRef ? [list] : list instanceof PDFArray ? list.asArray() : [];
    const pieces = refs.filter((ref): ref is PDFRef => ref instanceof PDFRef);
    // A page split into several streams is joined first, since one colour command can be cut across two.
    if (pieces.length > 1) {
      const sources = pieces.map((ref) => {
        const stream = context.lookup(ref);
        return stream instanceof PDFRawStream ? contents(stream) : null;
      });
      if (sources.every(Boolean)) {
        const joined = toBytes(grayContent(sources.map((source) => toText(source as Uint8Array)).join("\n"), context, resources));
        const ref = context.register(context.flateStream(joined));
        page.node.set(name("Contents"), ref);
        continue;
      }
    }
    for (const ref of pieces) {
      const stream = context.lookup(ref);
      if (stream instanceof PDFRawStream) rewriteStream(context, ref, stream, resources);
    }
  }
  // Drawings used inside pages (forms, tiling patterns, field appearances), and pictures.
  const objects = context.enumerateIndirectObjects();
  for (const [index, [ref, object]] of objects.entries()) {
    if (!(object instanceof PDFRawStream)) continue;
    const subtype = object.dict.lookup(name("Subtype"));
    const resources = object.dict.lookup(name("Resources"));
    if (subtype === name("Form") || object.dict.lookup(name("PatternType")) instanceof PDFNumber) {
      rewriteStream(context, ref, object, resources instanceof PDFDict ? resources : undefined);
    } else if (subtype === name("Image")) {
      await grayImage(context, ref, object, grayJpeg);
    }
    onProgress((index + 1) / objects.length);
  }
  return document.save();
}

// Like most PDF tools: "flyer.pdf" becomes "flyer_grayscale.pdf".
export function grayName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_grayscale.pdf`;
}
