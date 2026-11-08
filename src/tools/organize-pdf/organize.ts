import { PDFDocument, PageSizes, degrees, type PDFPage } from "pdf-lib";
import { JobError } from "../../lib/worker/host";

export type PlanStep = { file: number; page: number; rotate: 0 | 90 | 180 | 270 } | { blank: true };

export class OrganizeError extends JobError {
  constructor(code: "encrypted" | "unreadable" | "empty", fileName?: string) {
    super(code, fileName);
  }
}

// At most this many pages, so phones stay responsive.
export const MAX_PAGES = 2000;
const TURNS = [0, 90, 180, 270] as const;

// pdf-lib targets older JavaScript, where its error classes lose their identity, so the message is the reliable check.
function isEncrypted(error: unknown): boolean {
  return /is encrypted/i.test(String((error as Error)?.message));
}

// Reads the plan the options panel sends. Steps that point nowhere are dropped; odd turns count as none.
export function readPlan(text: string, fileCount: number): PlanStep[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const steps: PlanStep[] = [];
  for (const step of raw.slice(0, MAX_PAGES)) {
    if (!step || typeof step !== "object") continue;
    if ((step as { blank?: unknown }).blank === true) {
      steps.push({ blank: true });
      continue;
    }
    const { file, page, rotate } = step as Record<string, unknown>;
    if (!Number.isInteger(file) || (file as number) < 0 || (file as number) >= fileCount) continue;
    if (!Number.isInteger(page) || (page as number) < 1) continue;
    const turn = TURNS.find((value) => value === rotate) ?? 0;
    steps.push({ file: file as number, page: page as number, rotate: turn });
  }
  return steps;
}

// The size a page is shown at, after its rotation: sideways pages swap width and height.
function shownSize(page: PDFPage): [number, number] {
  const { width, height } = page.getSize();
  return page.getRotation().angle % 180 === 0 ? [width, height] : [height, width];
}

// Builds one PDF from the plan: pages in the new order, each turned on top of its own rotation, with blank pages added.
export async function organizePdf(
  files: { name: string; bytes: Uint8Array }[],
  plan: PlanStep[],
  onProgress: (fraction: number) => void = () => {},
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (!plan.length) throw new OrganizeError("empty");
  const sources: PDFDocument[] = [];
  for (const file of files) {
    try {
      sources.push(await PDFDocument.load(file.bytes, { updateMetadata: false }));
    } catch (error) {
      throw new OrganizeError(isEncrypted(error) ? "encrypted" : "unreadable", file.name);
    }
  }
  const output = await PDFDocument.create();
  // First the real pages, so each blank page can take its size from a neighbour.
  const placed: (PDFPage | null)[] = [];
  for (const [index, step] of plan.entries()) {
    if ("blank" in step) {
      placed.push(null);
      continue;
    }
    const source = sources[step.file];
    if (!source || step.page > source.getPageCount()) {
      placed.push(null);
      continue;
    }
    const [page] = await output.copyPages(source, [step.page - 1]);
    page.setRotation(degrees((page.getRotation().angle + step.rotate) % 360));
    placed.push(page);
    onProgress(((index + 1) / plan.length) * 0.8);
  }
  const kept = plan.filter((step, index) => "blank" in step || placed[index]);
  if (!kept.length) throw new OrganizeError("empty");
  for (const [index, step] of plan.entries()) {
    const page = placed[index];
    if (page) {
      output.addPage(page);
      continue;
    }
    if (!("blank" in step)) continue;
    const next = placed.slice(index + 1).find(Boolean);
    const previous = placed.slice(0, index).reverse().find(Boolean);
    const neighbour = next ?? previous;
    output.addPage(neighbour ? shownSize(neighbour) : PageSizes.A4);
  }
  const bytes = await output.save();
  onProgress(1);
  return { bytes, pageCount: output.getPageCount() };
}
