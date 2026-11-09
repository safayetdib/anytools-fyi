// What can be placed on a page besides an uploaded signature: typed and drawn signatures, initials and the date.
// The plain maths and text behind them, so it runs anywhere.

export type Mark = "signature" | "initials" | "date";
export const MARKS: readonly Mark[] = ["signature", "initials", "date"];

export interface Day {
  year: number;
  // 1 to 12.
  month: number;
  day: number;
}

export const DATE_FORMATS = ["dmy", "mdy", "iso", "long"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const two = (value: number) => String(value).padStart(2, "0");

export function formatDate({ year, month, day }: Day, format: DateFormat): string {
  if (format === "dmy") return `${two(day)}/${two(month)}/${year}`;
  if (format === "mdy") return `${two(month)}/${two(day)}/${year}`;
  if (format === "iso") return `${year}-${two(month)}-${two(day)}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// A date picker's value, "2026-11-09", or null when it isn't a real day.
export function readDate(value: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? { year, month, day } : null;
}

// The day the person is in, from the device's own calendar.
export function todayOf(now: Date): Day {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

// Long names are cut to this many letters, like most initials.
const MAX_INITIALS = 4;

// The first letter of each word, as written: a Bangla letter keeps its vowel sign.
export function initialsOf(name: string): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, MAX_INITIALS)
    .map((word) => (segmenter.segment(word)[Symbol.iterator]().next().value?.segment ?? "").toLocaleUpperCase())
    .join("");
}

export interface Point {
  x: number;
  y: number;
}

export type Stroke = Point[];

// Pen widths in pixels on the drawing pad.
export const PEN_SIZES = { thin: 2, medium: 3.5, thick: 5.5 } as const;
export type PenSize = keyof typeof PEN_SIZES;

// The box that holds every stroke, with the pen's width around it, or null when nothing is drawn.
export function strokeBounds(strokes: Stroke[], pen: number) {
  const points = strokes.flat();
  if (!points.length) return null;
  const half = pen / 2;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - half;
  const top = Math.min(...ys) - half;
  return { left, top, width: Math.max(...xs) + half - left, height: Math.max(...ys) + half - top };
}
