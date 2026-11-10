import type { PdfDocument } from "../../lib/pdf/preview";
import { normalise, type Word } from "./compare";

// Runs in the page: pdf.js reads each PDF's text, in reading order, in its own worker.

interface TextPiece {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

// Every word in the PDF with the box it fills on its page as shown. Boxes are measured from each piece of text,
// sharing its width out by letters, which is close enough to highlight a word.
export async function wordsOf(doc: PdfDocument): Promise<Word[]> {
  const words: Word[] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      for (const item of items as TextPiece[]) {
        if (typeof item.str !== "string" || !item.str.trim()) continue;
        const [a, b, , d, x, y] = item.transform;
        const size = item.height || Math.hypot(b, d) || 10;
        // Along the line of text, which may run any way on the page.
        const length = Math.hypot(a, b) || 1;
        const along = [a / length, b / length];
        for (const match of item.str.matchAll(/\S+/g)) {
          const start = ((match.index ?? 0) / item.str.length) * item.width;
          const end = (((match.index ?? 0) + match[0].length) / item.str.length) * item.width;
          // The word's corners: from below the baseline to above the letters, start to end.
          const corners = [
            [x + along[0] * start - along[1] * -0.25 * size, y + along[1] * start + along[0] * -0.25 * size],
            [x + along[0] * end - along[1] * 0.9 * size, y + along[1] * end + along[0] * 0.9 * size],
            [x + along[0] * start - along[1] * 0.9 * size, y + along[1] * start + along[0] * 0.9 * size],
            [x + along[0] * end - along[1] * -0.25 * size, y + along[1] * end + along[0] * -0.25 * size],
          ].map(([px, py]) => viewport.convertToViewportPoint(px, py) as [number, number]);
          const xs = corners.map(([cx]) => cx);
          const ys = corners.map(([, cy]) => cy);
          const left = Math.max(0, Math.min(...xs));
          const top = Math.max(0, Math.min(...ys));
          words.push({
            text: normalise(match[0]) || match[0],
            page: number,
            x: left / viewport.width,
            y: top / viewport.height,
            width: Math.min(viewport.width, Math.max(...xs)) / viewport.width - left / viewport.width,
            height: Math.min(viewport.height, Math.max(...ys)) / viewport.height - top / viewport.height,
          });
        }
      }
    } finally {
      page.cleanup();
    }
  }
  return words;
}
