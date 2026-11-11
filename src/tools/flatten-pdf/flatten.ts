import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  StandardFonts,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import { dropUnreachable } from "../../lib/pdf/prune";
import { JobError } from "../../lib/worker/host";

// Flattening draws form fields and comments into the page they sit on, as ordinary page content, and takes away the
// fields and comments themselves, so nothing can be filled in, changed or hidden again.

export class FlattenError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "nothing") {
    super(code);
  }
}

export interface FlattenChoice {
  forms: boolean;
  marks: boolean;
}

export interface FlattenResult {
  bytes: Uint8Array;
  fields: number;
  marks: number;
}

// Marks that aren't drawn on the page, or that do something besides show: links, attached files, sound and video.
// A redaction mark only covers its text, which would still be there, so it's left for Redact PDF to apply.
const KEEP = new Set(["Link", "Popup", "FileAttachment", "Sound", "Movie", "Screen", "RichMedia", "3D", "Redact", "Projection"]);
// Annotation flags: hidden, and not shown on screen.
const HIDDEN = 2 | 32;

const name = (dict: PDFDict, key: string) => dict.lookupMaybe(PDFName.of(key), PDFName)?.decodeText();
const numbers = (array: PDFArray | undefined) => array?.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : 0));

// The stream that shows an annotation as it is now: its normal appearance, picking the current state for tick boxes.
function appearanceOf(doc: PDFDocument, annot: PDFDict): PDFRef | null {
  const normal = annot.lookupMaybe(PDFName.of("AP"), PDFDict)?.get(PDFName.of("N"));
  const value = normal instanceof PDFRef ? doc.context.lookup(normal) : normal;
  if (value instanceof PDFStream) return normal instanceof PDFRef ? normal : doc.context.register(value);
  if (value instanceof PDFDict) {
    const state = annot.lookupMaybe(PDFName.of("AS"), PDFName);
    const chosen = state ? value.get(state) : undefined;
    if (chosen instanceof PDFRef && doc.context.lookup(chosen) instanceof PDFStream) return chosen;
  }
  return null;
}

// Draws an appearance stream into its annotation's box, the way a reader shows it (PDF 2.0, 12.5.5).
function draw(doc: PDFDocument, page: PDFPage, annot: PDFDict, ref: PDFRef) {
  const stream = doc.context.lookup(ref, PDFStream);
  const rect = numbers(annot.lookupMaybe(PDFName.of("Rect"), PDFArray));
  const bbox = numbers(stream.dict.lookupMaybe(PDFName.of("BBox"), PDFArray));
  if (!rect || rect.length < 4 || !bbox || bbox.length < 4) return;
  const [a, b, c, d, e, f] = numbers(stream.dict.lookupMaybe(PDFName.of("Matrix"), PDFArray)) ?? [1, 0, 0, 1, 0, 0];
  const corners = [
    [bbox[0], bbox[1]],
    [bbox[2], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[3]],
  ].map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
  const left = Math.min(...corners.map(([x]) => x));
  const right = Math.max(...corners.map(([x]) => x));
  const bottom = Math.min(...corners.map(([, y]) => y));
  const top = Math.max(...corners.map(([, y]) => y));
  const box = { x: Math.min(rect[0], rect[2]), y: Math.min(rect[1], rect[3]), width: Math.abs(rect[2] - rect[0]), height: Math.abs(rect[3] - rect[1]) };
  if (right - left <= 0 || top - bottom <= 0 || box.width <= 0 || box.height <= 0) return;
  const sx = box.width / (right - left);
  const sy = box.height / (top - bottom);
  // Some files leave out what kind of object the appearance is.
  stream.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
  stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
  const key = page.node.newXObject("Flat", ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(sx, 0, 0, sy, box.x - left * sx, box.y - bottom * sy), drawObject(key), popGraphicsState());
}

// Gives fields that have no picture of their value, or an out-of-date one, a new one where the built-in font can draw it.
async function refreshFields(doc: PDFDocument) {
  const form = doc.getForm();
  const stale = form.acroForm.dict.lookupMaybe(PDFName.of("NeedAppearances"), PDFBool)?.asBoolean() ?? false;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const field of form.getFields()) {
    const missing = field.acroField.getWidgets().some((widget) => !widget.getAppearances()?.normal);
    if (!stale && !missing) continue;
    try {
      field.defaultUpdateAppearances(font);
    } catch {
      // Text the built-in font can't draw, like Bangla, keeps the picture it had.
    }
  }
}

export async function flattenPdf(bytes: Uint8Array, choice: FlattenChoice): Promise<FlattenResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new FlattenError(/is encrypted/i.test(String((error as Error)?.message)) ? "encrypted" : "unreadable");
  }
  const hasForm = doc.catalog.has(PDFName.of("AcroForm"));
  // Which field each box belongs to, to count fields rather than boxes.
  const fieldOf = new Map<PDFDict, string>();
  if (choice.forms && hasForm) {
    await refreshFields(doc);
    for (const field of doc.getForm().getFields()) for (const widget of field.acroField.getWidgets()) fieldOf.set(widget.dict, field.getName());
  }
  const fields = new Set<string>();
  let marks = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const kept: PDFObject[] = [];
    const removed = new Set<PDFDict>();
    for (const item of annots.asArray()) {
      const annot = doc.context.lookup(item);
      if (!(annot instanceof PDFDict)) continue;
      const kind = name(annot, "Subtype") ?? "";
      const flatten = kind === "Widget" ? choice.forms : choice.marks && !KEEP.has(kind);
      const appearance = flatten ? appearanceOf(doc, annot) : null;
      const flags = annot.lookupMaybe(PDFName.of("F"), PDFNumber)?.asNumber() ?? 0;
      if (!flatten || (!appearance && !(flags & HIDDEN))) {
        kept.push(item);
        continue;
      }
      if (appearance && !(flags & HIDDEN)) draw(doc, page, annot, appearance);
      removed.add(annot);
      if (kind === "Widget") fields.add(fieldOf.get(annot) ?? String(fieldOf.size + fields.size));
      else marks++;
    }
    // A comment's pop-up note goes with it.
    const left = kept.filter((item) => {
      const annot = doc.context.lookup(item);
      if (!(annot instanceof PDFDict)) return true;
      const parent = annot.get(PDFName.of("Parent"));
      return !(name(annot, "Subtype") === "Popup" && parent instanceof PDFRef && removed.has(doc.context.lookup(parent, PDFDict)));
    });
    if (left.length) page.node.set(PDFName.of("Annots"), doc.context.obj(left));
    else page.node.delete(PDFName.of("Annots"));
  }
  if (!fields.size && !marks) throw new FlattenError("nothing");
  // Fields with no boxes left on any page are gone; the form goes when none are left.
  if (hasForm && fields.size) {
    const form = doc.getForm();
    const onPages = new Set<PDFDict>(doc.getPages().flatMap((page) => page.node.Annots()?.asArray().map((ref) => doc.context.lookup(ref) as PDFDict) ?? []));
    for (const field of form.getFields()) {
      if (field.acroField.getWidgets().some((widget) => onPages.has(widget.dict))) continue;
      try {
        form.acroForm.removeField(field.acroField);
      } catch {
        // Already gone with its parent.
      }
    }
    if (!form.getFields().length) doc.catalog.delete(PDFName.of("AcroForm"));
  }
  await dropUnreachable(doc);
  return { bytes: await doc.save({ updateFieldAppearances: false }), fields: fields.size, marks };
}

// "application.pdf" becomes "application_flattened.pdf".
export function flattenedName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_flattened.pdf`;
}
