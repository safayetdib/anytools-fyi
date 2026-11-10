import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { FONTS, canDraw, colour, shownSize } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";

// Everything is measured on the page as shown (turned and cropped as a reader shows it), from its top-left corner, as
// fractions of its width and height, so edits stay put whatever size the page was drawn at. Sizes of text and lines are
// in points.

export type Font = "helvetica" | "times" | "courier";
export type ShapeKind = "rect" | "ellipse" | "highlight" | "whiteout";

export type Edit =
  | {
      kind: "text";
      page: number;
      x: number;
      y: number;
      text: string;
      font: Font;
      size: number;
      bold: boolean;
      italic: boolean;
      color: string;
      // Where the first line's baseline sits below the box's top, as a share of the size, as the page measured it.
      baseline: number;
    }
  | { kind: "image"; page: number; x: number; y: number; width: number; height: number; image: number }
  | { kind: ShapeKind; page: number; x: number; y: number; width: number; height: number; color: string; fill: boolean; thickness: number }
  | { kind: "line"; page: number; x1: number; y1: number; x2: number; y2: number; color: string; thickness: number }
  | { kind: "draw"; page: number; points: [number, number][]; color: string; thickness: number };

// A picture placed as it is (JPG or PNG), or a line of text drawn in the page because the built-in fonts can't.
export interface EditImage {
  bytes: Uint8Array;
  kind: "jpg" | "png";
}

// Text with letters the built-in fonts lack comes as one picture for each line, drawn in the page. Sizes are in points,
// like TextPicture: `pad` spare room either side, the baseline `descent` above the bottom.
export interface LinePicture extends EditImage {
  width: number;
  ascent: number;
  descent: number;
  pad: number;
}

export const LINE_HEIGHT = 1.2;
export const MAX_EDITS = 2000;
const HIGHLIGHT = "#ffe14d";

export class EditError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

const share = (value: unknown) => Math.min(1, Math.max(0, Number(value)));
const finite = (...values: unknown[]) => values.every((value) => value !== null && value !== "" && Number.isFinite(Number(value)));
const hex = (value: unknown) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000");
const between = (value: unknown, low: number, high: number, fallback: number) =>
  finite(value) ? Math.min(high, Math.max(low, Number(value))) : fallback;

// Reads the panel's edits, dropping anything that isn't a whole, sensible edit.
export function readEdits(text: string): Edit[] {
  let raw: unknown = [];
  try {
    raw = JSON.parse(text);
  } catch {
    // Nothing added yet.
  }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_EDITS).flatMap((item): Edit[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (!Number.isInteger(value.page) || (value.page as number) < 1) return [];
    const page = value.page as number;
    switch (value.kind) {
      case "text": {
        const text = typeof value.text === "string" ? value.text.replace(/\r\n?/g, "\n") : "";
        if (!text.trim() || !finite(value.x, value.y)) return [];
        const font = (["helvetica", "times", "courier"] as const).find((name) => name === value.font) ?? "helvetica";
        return [{
          kind: "text", page, x: share(value.x), y: share(value.y), text, font,
          size: between(value.size, 4, 200, 14), bold: value.bold === true, italic: value.italic === true,
          color: hex(value.color), baseline: between(value.baseline, 0.5, 1.2, 0.9),
        }];
      }
      case "image":
        if (!finite(value.x, value.y, value.width, value.height) || !Number.isInteger(value.image) || (value.image as number) < 0) return [];
        return [{ kind: "image", page, x: share(value.x), y: share(value.y), width: share(value.width), height: share(value.height), image: value.image as number }];
      case "rect":
      case "ellipse":
      case "highlight":
      case "whiteout":
        if (!finite(value.x, value.y, value.width, value.height)) return [];
        return [{
          kind: value.kind, page, x: share(value.x), y: share(value.y), width: share(value.width), height: share(value.height),
          color: hex(value.color), fill: value.fill === true, thickness: between(value.thickness, 0.5, 20, 2),
        }];
      case "line":
        if (!finite(value.x1, value.y1, value.x2, value.y2)) return [];
        return [{ kind: "line", page, x1: share(value.x1), y1: share(value.y1), x2: share(value.x2), y2: share(value.y2), color: hex(value.color), thickness: between(value.thickness, 0.5, 20, 2) }];
      case "draw": {
        const points = Array.isArray(value.points) ? value.points.filter((point) => Array.isArray(point) && finite(point[0], point[1])) : [];
        if (!points.length) return [];
        return [{ kind: "draw", page, points: points.map((point) => [share(point[0]), share(point[1])] as [number, number]), color: hex(value.color), thickness: between(value.thickness, 0.5, 20, 2) }];
      }
      default:
        return [];
    }
  });
}

// From the page as shown (points, from its bottom-left corner) to the page's own coordinates, for each turn.
export function shownToPage(page: PDFPage): [number, number, number, number, number, number] {
  const { x, y, width, height } = page.getCropBox();
  const turn = ((page.getRotation().angle % 360) + 360) % 360;
  if (turn === 90) return [0, 1, -1, 0, x + width, y];
  if (turn === 180) return [-1, 0, 0, -1, x + width, y + height];
  if (turn === 270) return [0, -1, 1, 0, x, y + height];
  return [1, 0, 0, 1, x, y];
}

// Makes the changes on the pages, in the order they were added, so later ones sit on top.
export async function editPdf(bytes: Uint8Array, edits: Edit[], images: EditImage[], pictures: Record<number, LinePicture[]> = {}): Promise<Uint8Array> {
  if (!edits.length) throw new EditError("empty");
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new EditError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
  // Each picture and font goes into the file once, however often it's used.
  const embeddedImages = new Map<number, PDFImage>();
  const embedImage = async (image: EditImage) => (image.kind === "png" ? document.embedPng(image.bytes) : document.embedJpg(image.bytes));
  const fonts = new Map<string, PDFFont>();
  const fontFor = async (font: Font, bold: boolean, italic: boolean) => {
    const name = FONTS[font][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!fonts.has(name)) fonts.set(name, await document.embedFont(name));
    return fonts.get(name) as PDFFont;
  };

  const byPage = new Map<number, [number, Edit][]>();
  edits.forEach((edit, index) => {
    if (edit.page > document.getPageCount()) return;
    byPage.set(edit.page, [...(byPage.get(edit.page) ?? []), [index, edit]]);
  });
  for (const [number, list] of byPage) {
    const page = document.getPage(number - 1);
    const [width, height] = shownSize(page);
    // Points on the page as shown, from the top-left corner like the panel measures.
    const px = (share: number) => share * width;
    const py = (share: number) => height - share * height;
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...shownToPage(page)));
    for (const [index, edit] of list) {
      switch (edit.kind) {
        case "text": {
          const lines = edit.text.split("\n");
          const lineGap = edit.size * LINE_HEIGHT;
          const first = py(edit.y) - edit.size * edit.baseline;
          const linePictures = pictures[index];
          if (canDraw(edit.text.replace(/\n/g, ""))) {
            const font = await fontFor(edit.font, edit.bold, edit.italic);
            lines.forEach((line, row) => page.drawText(line, { x: px(edit.x), y: first - row * lineGap, size: edit.size, font, color: colour(edit.color) }));
          } else if (linePictures) {
            for (const [row, picture] of linePictures.entries()) {
              if (!picture) continue;
              const image = await embedImage(picture);
              page.drawImage(image, {
                x: px(edit.x) - picture.pad,
                y: first - row * lineGap - picture.descent,
                width: picture.width + picture.pad * 2,
                height: picture.ascent + picture.descent,
              });
            }
          }
          break;
        }
        case "image": {
          const source = images[edit.image];
          if (!source) break;
          if (!embeddedImages.has(edit.image)) embeddedImages.set(edit.image, await embedImage(source));
          page.drawImage(embeddedImages.get(edit.image) as PDFImage, { x: px(edit.x), y: py(edit.y + edit.height), width: px(edit.width), height: edit.height * height });
          break;
        }
        case "rect":
        case "highlight":
        case "whiteout": {
          const box = { x: px(edit.x), y: py(edit.y + edit.height), width: px(edit.width), height: edit.height * height };
          if (edit.kind === "highlight") page.drawRectangle({ ...box, color: colour(HIGHLIGHT), blendMode: BlendMode.Multiply });
          else if (edit.kind === "whiteout") page.drawRectangle({ ...box, color: colour("#ffffff") });
          else {
            page.drawRectangle({
              ...box,
              color: edit.fill ? colour(edit.color) : undefined,
              borderColor: edit.fill ? undefined : colour(edit.color),
              borderWidth: edit.fill ? 0 : edit.thickness,
            });
          }
          break;
        }
        case "ellipse":
          page.drawEllipse({
            x: px(edit.x + edit.width / 2),
            y: py(edit.y + edit.height / 2),
            xScale: px(edit.width) / 2,
            yScale: (edit.height * height) / 2,
            color: edit.fill ? colour(edit.color) : undefined,
            borderColor: edit.fill ? undefined : colour(edit.color),
            borderWidth: edit.fill ? 0 : edit.thickness,
          });
          break;
        case "line":
          page.drawLine({
            start: { x: px(edit.x1), y: py(edit.y1) },
            end: { x: px(edit.x2), y: py(edit.y2) },
            thickness: edit.thickness,
            color: colour(edit.color),
            lineCap: LineCapStyle.Round,
          });
          break;
        case "draw": {
          // An SVG path is measured downwards from where it's drawn, here the top-left corner of the page as shown.
          const [start, ...rest] = edit.points.map(([x, y]) => `${(x * width).toFixed(2)} ${(y * height).toFixed(2)}`);
          const path = rest.length ? `M ${start} L ${rest.join(" L ")}` : `M ${start} L ${start}`;
          page.drawSvgPath(path, { x: 0, y: height, borderColor: colour(edit.color), borderWidth: edit.thickness, borderLineCap: LineCapStyle.Round });
          break;
        }
      }
    }
    page.pushOperators(popGraphicsState());
  }
  return document.save();
}

// Like most PDF tools: "form.pdf" becomes "form_edited.pdf".
export function editedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_edited.pdf`;
}
