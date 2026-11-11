import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  PDFBool,
  type PDFField,
  type PDFPage,
  type PDFWidgetAnnotation,
} from "pdf-lib";
import { canDraw } from "../../lib/pdf/stamp";
import { JobError } from "../../lib/worker/host";
import { shownToPage, type LinePicture } from "../edit-pdf/edit";

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list";

// Where one of a field's boxes sits, on the page as shown, from its top-left corner, as fractions of its size.
export interface FieldSpot {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  // For a round choice: the answer this box stands for.
  option?: string;
}

export interface FormField {
  name: string;
  kind: FieldKind;
  // Text, the chosen answer of a round choice or drop-down, or "true" for a ticked box.
  value: string;
  // Chosen answers of a list that allows several.
  values: string[];
  options: string[];
  multiline: boolean;
  multiple: boolean;
  maxLength: number | null;
  readOnly: boolean;
  spots: FieldSpot[];
}

// What was filled in, by field name: text, a chosen answer, true or false for a tick, or several answers for a list.
export type Answers = Record<string, string | boolean | string[]>;

export class FormError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "noFields" | "text") {
    super(code);
  }
}

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new FormError(isEncrypted(error) ? "encrypted" : "unreadable");
  }
}

const kindOf = (field: PDFField): FieldKind | null =>
  field instanceof PDFTextField
    ? "text"
    : field instanceof PDFCheckBox
      ? "checkbox"
      : field instanceof PDFRadioGroup
        ? "radio"
        : field instanceof PDFDropdown
          ? "dropdown"
          : field instanceof PDFOptionList
            ? "list"
            : null;

// A box in the page's own coordinates, as a box on the page as shown, measured from its top-left corner in fractions.
export function toShown(page: PDFPage, rect: { x: number; y: number; width: number; height: number }) {
  const [a, b, c, d, e, f] = shownToPage(page);
  // The transform only turns by quarter turns, so undoing it swaps and flips the axes.
  const determinant = a * d - b * c;
  const back = (x: number, y: number) => [(d * (x - e) - c * (y - f)) / determinant, (-b * (x - e) + a * (y - f)) / determinant];
  const corners = [back(rect.x, rect.y), back(rect.x + rect.width, rect.y + rect.height)];
  const box = page.getCropBox();
  const turned = page.getRotation().angle % 180 !== 0;
  const [width, height] = turned ? [box.height, box.width] : [box.width, box.height];
  const left = Math.min(corners[0][0], corners[1][0]);
  const right = Math.max(corners[0][0], corners[1][0]);
  const bottom = Math.min(corners[0][1], corners[1][1]);
  const top = Math.max(corners[0][1], corners[1][1]);
  return { x: left / width, y: 1 - top / height, width: (right - left) / width, height: (top - bottom) / height };
}

// Finds the page a field's box is on: from the box itself, or from the pages' lists of annotations when it doesn't say.
function pageFinder(document: PDFDocument) {
  const pages = document.getPages();
  const byRef = new Map(pages.map((page, index) => [page.ref.toString(), index]));
  const byDict = new Map<unknown, number>();
  pages.forEach((page, index) => page.node.Annots()?.asArray().forEach((ref) => byDict.set(document.context.lookup(ref), index)));
  return (widget: PDFWidgetAnnotation) => byRef.get(widget.P()?.toString() ?? "") ?? byDict.get(widget.dict);
}

// The form's fields, with each box where the page shows it.
export async function readForm(bytes: Uint8Array): Promise<FormField[]> {
  const document = await load(bytes);
  const pages = document.getPages();
  const pageOf = pageFinder(document);
  const fields: FormField[] = [];
  for (const field of document.getForm().getFields()) {
    const kind = kindOf(field);
    if (!kind) continue;
    const spots: FieldSpot[] = [];
    // A round choice lists its answers in the order of its boxes; its boxes may only be numbered inside.
    const answers = field instanceof PDFRadioGroup ? field.getOptions() : [];
    for (const [at, widget] of field.acroField.getWidgets().entries()) {
      const index = pageOf(widget);
      if (index === undefined) continue;
      const spot: FieldSpot = { page: index + 1, ...toShown(pages[index], widget.getRectangle()) };
      if (kind === "radio") spot.option = answers[at] ?? widget.getOnValue()?.decodeText();
      if (spot.width > 0 && spot.height > 0) spots.push(spot);
    }
    if (!spots.length) continue;
    const text = field instanceof PDFTextField ? field : null;
    const choice = field instanceof PDFDropdown || field instanceof PDFOptionList ? field : null;
    fields.push({
      name: field.getName(),
      kind,
      value:
        text?.getText() ??
        (field instanceof PDFCheckBox ? String(field.isChecked()) : field instanceof PDFRadioGroup ? (field.getSelected() ?? "") : (choice?.getSelected()[0] ?? "")),
      values: choice?.getSelected() ?? [],
      options: field instanceof PDFRadioGroup ? field.getOptions() : (choice?.getOptions() ?? []),
      multiline: text?.isMultiline() ?? false,
      multiple: choice?.isMultiselect() ?? false,
      maxLength: text?.getMaxLength() ?? null,
      readOnly: field.isReadOnly(),
      spots,
    });
  }
  return fields;
}

export function readAnswers(text: string): Answers {
  let raw: unknown = {};
  try {
    raw = JSON.parse(text);
  } catch {
    // Nothing filled in yet.
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const answers: Answers = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "boolean") answers[name] = value;
    else if (Array.isArray(value)) answers[name] = value.filter((item): item is string => typeof item === "string");
  }
  return answers;
}

// Fills in the answers. Flattening turns the fields into ordinary page content, so they can't be changed. Text the
// built-in font can't draw (Bangla) keeps its value for readers to draw; when flattening, its picture from the page
// is drawn in the field's place instead.
export async function fillForm(bytes: Uint8Array, answers: Answers, flatten: boolean, pictures: Record<string, LinePicture> = {}): Promise<Uint8Array> {
  const document = await load(bytes);
  const form = document.getForm();
  const fields = form.getFields();
  if (!fields.length) throw new FormError("noFields");
  const font = await document.embedFont(StandardFonts.Helvetica);
  // Fields whose text the built-in font can't draw.
  const drawnLater: PDFTextField[] = [];
  for (const field of fields) {
    const answer = answers[field.getName()];
    if (answer === undefined || field.isReadOnly()) continue;
    try {
      if (field instanceof PDFTextField) {
        const text = String(answer);
        const limit = field.getMaxLength();
        field.setText(limit === undefined ? text : text.slice(0, limit));
        if (!canDraw(text.replace(/\n/g, ""))) drawnLater.push(field);
      } else if (field instanceof PDFCheckBox) {
        if (answer === true || answer === "true") field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof answer === "string" && field.getOptions().includes(answer)) field.select(answer);
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        const chosen = (Array.isArray(answer) ? answer : [String(answer)]).filter((option) => field.getOptions().includes(option));
        if (chosen.length) field.select(field.isMultiselect() ? chosen : chosen[0]);
        else field.clear();
      }
    } catch {
      // A field that refuses an answer (a bad combing setting, say) keeps what it had.
    }
  }
  // Appearances for everything the built-in font can draw; the rest are drawn by the reader, or below when flattening.
  for (const field of fields) {
    if (drawnLater.includes(field as PDFTextField)) {
      form.markFieldAsClean(field.ref);
      continue;
    }
    try {
      field.defaultUpdateAppearances(font);
    } catch {
      form.markFieldAsClean(field.ref);
    }
  }
  if (drawnLater.length && !flatten) {
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  }
  if (flatten) {
    const pages = document.getPages();
    const pageOf = pageFinder(document);
    for (const field of drawnLater) {
      const picture = pictures[field.getName()];
      for (const widget of field.acroField.getWidgets()) {
        const index = pageOf(widget);
        if (index === undefined || !picture) continue;
        const page = pages[index];
        const rect = widget.getRectangle();
        const image = await document.embedPng(picture.bytes);
        // The text's own size, shrunk if needed to fit the box, starting two points in and centred up and down.
        const scale = Math.min(1, (rect.width - 4) / (picture.width + picture.pad * 2), rect.height / (picture.ascent + picture.descent));
        const height = (picture.ascent + picture.descent) * scale;
        page.drawImage(image, { x: rect.x + 2, y: rect.y + (rect.height - height) / 2, width: (picture.width + picture.pad * 2) * scale, height });
      }
      form.removeField(field);
    }
    form.flatten({ updateFieldAppearances: false });
  }
  return document.save({ updateFieldAppearances: false });
}

// Like most PDF tools: "application.pdf" becomes "application_filled.pdf".
export function filledName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}_filled.pdf`;
}
