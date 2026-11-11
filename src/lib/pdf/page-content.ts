import { loadPdfjs, type PdfDocument } from "./preview";

// Reads what a page holds, for the tools that rebuild PDFs as Office files: each piece of text with its font and place,
// and each picture with where it's drawn. Runs in the page: pdf.js does the reading in its own worker.

type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type Matrix = [number, number, number, number, number, number];

export interface FontStyle {
  // A font name Office knows, such as "Times New Roman", or null to use the document's default.
  family: string | null;
  bold: boolean;
  italic: boolean;
}

// A piece of text on the page as shown, in points from its top-left corner.
export interface TextPiece {
  text: string;
  x: number;
  // Where the letters sit, measured down from the top.
  baseline: number;
  width: number;
  size: number;
  font: FontStyle;
  // False for text that runs up, down or at a slant.
  upright: boolean;
}

// A picture as placed on the page as shown, in points from its top-left corner.
export interface PicturePlace {
  x: number;
  y: number;
  width: number;
  height: number;
  // The same picture drawn more than once shares a key.
  key: string;
  draw: (maxWidth: number) => Promise<PictureFile | null>;
}

export interface PictureFile {
  bytes: Uint8Array;
  type: "png" | "jpeg";
  width: number;
  height: number;
}

export interface PageContent {
  width: number;
  height: number;
  pieces: TextPiece[];
  pictures: PicturePlace[];
  // Text that is there to search but isn't drawn, like the text OCR adds behind a scan.
  hiddenText: boolean;
}

interface PdfImage {
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: Uint8ClampedArray;
  kind?: number;
}

interface TextItem {
  str?: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface FontInfo {
  name?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  isSerifFont?: boolean;
  isMonospace?: boolean;
}

// pdf.js's numbers for the drawing steps followed here.
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  setTextRenderingMode: 38,
  showText: [44, 45, 46, 47],
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
};
// Fill, stroke, fill and stroke, and the same with clipping: everything except invisible (3) and clip only (7).
const HIDDEN_MODES = new Set([3, 7]);
// Pictures smaller than this on a side are lines and dots, not photos.
const MIN_PICTURE_SIDE = 8;
// Pictures are kept sharp enough to print: up to this many pixels for each point they fill on the page.
const PIXELS_PER_POINT = 3;
const MAX_PICTURE_SIDE = 4096;

// Office's names for the fonts PDFs most often use. Keys are lower case with spaces taken out.
const KNOWN_FONTS: Record<string, string> = {
  helvetica: "Arial",
  helveticaneue: "Helvetica Neue",
  arial: "Arial",
  arialnarrow: "Arial Narrow",
  times: "Times New Roman",
  timesroman: "Times New Roman",
  timesnewroman: "Times New Roman",
  courier: "Courier New",
  couriernew: "Courier New",
  symbol: "Symbol",
  zapfdingbats: "Wingdings",
  glyphlessfont: "",
};

function multiply(m: number[], n: number[]): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// "ABCDEF+TimesNewRomanPS-BoldItalicMT" as Office would name it, and whether it's bold or italic.
export function fontStyle(name: string | undefined, flags: { bold?: boolean; italic?: boolean; serif?: boolean; mono?: boolean } = {}): FontStyle {
  const raw = (name ?? "").replace(/^[A-Z]{6}\+/, "");
  const [base, ...rest] = raw.split(/[-,]/);
  const style = rest.join(" ");
  // Some names run the style on with no dash: "ArialBold".
  const joined = /^(.+?)(Bold|Italic|Oblique|BoldItalic|BoldOblique)$/.exec(base);
  const family = (joined ? joined[1] : base).replace(/(PSMT|PS|MT)$/, "");
  const styleWords = `${style} ${joined ? joined[2] : ""}`;
  const known = KNOWN_FONTS[family.toLowerCase().replace(/\s+/g, "")];
  let office: string | null;
  if (known !== undefined) office = known || null;
  else if (family) office = family.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  else office = null;
  // A font with no name of its own falls back to the kind it is.
  if (!office) office = flags.mono ? "Courier New" : flags.serif ? "Times New Roman" : null;
  return {
    family: office,
    bold: /bold|black|heavy|semibold|demi|extrabold/i.test(styleWords) || !!flags.bold,
    italic: /italic|oblique/i.test(styleWords) || !!flags.italic,
  };
}

function fontInfo(page: PdfPage, name: string): FontInfo {
  try {
    const store = name.startsWith("g_") ? page.commonObjs : page.objs;
    return store.has(name) ? ((store.get(name) as FontInfo) ?? {}) : {};
  } catch {
    return {};
  }
}

function imageObject(page: PdfPage, name: string): Promise<PdfImage | null> {
  // Pictures shared across pages live in commonObjs, named "g_…".
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      store.get(name, (value: unknown) => resolve((value as PdfImage) ?? null));
    } catch {
      resolve(null);
    }
  });
}

function toCanvas(image: PdfImage): CanvasImageSource | null {
  if (image.bitmap) return image.bitmap;
  if (!image.data) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const pixels = new Uint8ClampedArray(image.width * image.height * 4);
  const kind = image.kind ?? 3;
  const source = image.data;
  if (kind === 3) pixels.set(source.subarray(0, pixels.length));
  else if (kind === 2) {
    for (let i = 0, j = 0; j < pixels.length; i += 3, j += 4) {
      pixels[j] = source[i];
      pixels[j + 1] = source[i + 1];
      pixels[j + 2] = source[i + 2];
      pixels[j + 3] = 255;
    }
  } else {
    // One bit for each pixel, rows padded to whole bytes, as in a black and white scan.
    const rowBytes = Math.ceil(image.width / 8);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const on = (source[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const j = (y * image.width + x) * 4;
        pixels[j] = pixels[j + 1] = pixels[j + 2] = on ? 255 : 0;
        pixels[j + 3] = 255;
      }
    }
  }
  context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  return canvas;
}

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encode failed"))), type, quality));

// Draws a picture the way the page shows it, turned or flipped as placed, at most `maxWidth` pixels wide. Photos are
// saved as JPG; pictures with see-through parts as PNG.
async function drawPicture(image: PdfImage, shown: Matrix, box: { x: number; y: number; width: number; height: number }, maxWidth: number): Promise<PictureFile | null> {
  const source = toCanvas(image);
  if (!source) return null;
  const scale = Math.min(maxWidth / box.width, PIXELS_PER_POINT, MAX_PICTURE_SIDE / Math.max(box.width, box.height), Math.max(image.width, image.height) / Math.max(box.width, box.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  try {
    context.setTransform(scale * shown[0], scale * shown[1], scale * shown[2], scale * shown[3], scale * (shown[4] - box.x), scale * (shown[5] - box.y));
    // A PDF picture fills the unit square with its top row at the top, which is y = 1.
    context.transform(1 / image.width, 0, 0, -1 / image.height, 0, 1);
    context.drawImage(source, 0, 0, image.width, image.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let opaque = true;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        opaque = false;
        break;
      }
    }
    const blob = opaque ? await encode(canvas, "image/jpeg", 0.88) : await encode(canvas, "image/png");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: opaque ? "jpeg" : "png", width: canvas.width, height: canvas.height };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    if (source instanceof HTMLCanvasElement) {
      source.width = 0;
      source.height = 0;
    }
  }
}

export class PdfLocked extends Error {}

// Opens a PDF with its fonts' names, which say whether text is bold or italic and what font it's set in.
export async function openWithFonts(file: File): Promise<{ doc: PdfDocument; close: () => void }> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), fontExtraProperties: true });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (error) {
    void task.destroy();
    throw (error as Error)?.name === "PasswordException" ? new PdfLocked() : error;
  }
}

// Everything on one page, turned the way the PDF shows it.
export async function readPageContent(page: PdfPage, options: { pictures: boolean } = { pictures: true }): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 });
  const view = viewport.transform as Matrix;
  // The fonts reach the page while the drawing steps are read, so these come first.
  const { fnArray, argsArray } = await page.getOperatorList();
  const { items, styles } = await page.getTextContent();

  const pieces: TextPiece[] = [];
  const fonts = new Map<string, FontStyle>();
  for (const item of items as TextItem[]) {
    if (typeof item.str !== "string" || !item.str) continue;
    let font = fonts.get(item.fontName);
    if (!font) {
      const info = fontInfo(page, item.fontName);
      const family = (styles as Record<string, { fontFamily?: string }>)[item.fontName]?.fontFamily;
      font = fontStyle(info.name, {
        bold: info.bold || info.black,
        italic: info.italic,
        serif: info.isSerifFont || family === "serif",
        mono: info.isMonospace || family === "monospace",
      });
      fonts.set(item.fontName, font);
    }
    const [a, b, c, d, e, f] = item.transform;
    const shown = multiply(view, [a, b, c, d, e, f]);
    const run = Math.hypot(shown[0], shown[1]) || 1;
    pieces.push({
      text: item.str,
      x: shown[4],
      baseline: shown[5],
      width: item.width,
      size: item.height || Math.hypot(c, d) || 10,
      font,
      upright: shown[0] > 0 && Math.abs(shown[1]) / run < 0.05,
    });
  }

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let mode = 0;
  const stack: { ctm: Matrix; mode: number }[] = [];
  let shownText = 0;
  let hiddenText = 0;
  const pictures: PicturePlace[] = [];
  for (const [index, fn] of fnArray.entries()) {
    const args = argsArray[index] as unknown[];
    if (fn === OPS.save) stack.push({ ctm, mode });
    else if (fn === OPS.restore) ({ ctm, mode } = stack.pop() ?? { ctm, mode });
    else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
    else if (fn === OPS.setTextRenderingMode) mode = Number(args[0]);
    else if (OPS.showText.includes(fn)) {
      if (HIDDEN_MODES.has(mode)) hiddenText++;
      else shownText++;
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, mode });
      if (Array.isArray(args[0]) && args[0].length === 6) ctm = multiply(ctm, args[0] as number[]);
    } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, mode } = stack.pop() ?? { ctm, mode });
    else if (options.pictures && (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject)) {
      const shown = multiply(view, ctm);
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([u, v]) => [shown[0] * u + shown[2] * v + shown[4], shown[1] * u + shown[3] * v + shown[5]]);
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const left = Math.max(0, Math.min(...xs));
      const top = Math.max(0, Math.min(...ys));
      const box = { x: left, y: top, width: Math.min(viewport.width, Math.max(...xs)) - left, height: Math.min(viewport.height, Math.max(...ys)) - top };
      if (box.width < 2 || box.height < 2) continue;
      const inline = fn === OPS.paintInlineImageXObject ? (args[0] as PdfImage) : null;
      const name = inline ? `inline-${index}` : String(args[0]);
      const place = { ...box, x: left, y: top };
      // The same picture placed the same way round is saved once, however often it's drawn.
      const way = shown.slice(0, 4).map((value) => Math.sign(Math.round(value * 1000))).join("");
      pictures.push({
        ...place,
        key: `${name}:${way}`,
        async draw(maxWidth) {
          const image = inline ?? (await imageObject(page, name));
          if (!image || image.width < MIN_PICTURE_SIDE || image.height < MIN_PICTURE_SIDE) return null;
          // The picture's own place, shifted so its box starts at the box's corner.
          return drawPicture(image, shown, place, maxWidth);
        },
      });
    }
  }
  return { width: viewport.width, height: viewport.height, pieces, pictures, hiddenText: hiddenText > shownText };
}
