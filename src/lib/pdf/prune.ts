import { PDFArray, PDFDict, PDFRef, PDFStream, type PDFDocument, type PDFObject } from "pdf-lib";

// pdf-lib saves every object it read, even ones nothing points to any more. After a tool takes something out, such
// as a comment or the document's details, this drops whatever is left over, so it doesn't stay hidden in the file.
export async function dropUnreachable(doc: PDFDocument): Promise<void> {
  // Fonts and pictures added in this session are written into the document first, so they count.
  await doc.flush();
  const { context } = doc;
  const seen = new Set<string>();
  const { Root, Info, Encrypt } = context.trailerInfo;
  const stack: (PDFObject | undefined)[] = [Root, Info, Encrypt];
  while (stack.length) {
    const object = stack.pop();
    if (!object) continue;
    if (object instanceof PDFRef) {
      if (seen.has(object.tag)) continue;
      seen.add(object.tag);
      stack.push(context.lookup(object));
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      stack.push(...object.asArray());
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) context.delete(ref);
  }
}
