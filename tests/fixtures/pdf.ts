import { createHash } from "node:crypto";
import { PDFDocument, rgb } from "pdf-lib";

// A PDF whose pages have the given widths, so tests can check page order.
export async function makePdf(widths: number[], height = 300): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) {
    // A small mark in the top-left corner gives each page content, like a real document.
    doc.addPage([width, height]).drawRectangle({ x: 4, y: height - 24, width: 20, height: 20, color: rgb(0.8, 0.25, 0.2) });
  }
  return doc.save({ useObjectStreams: false });
}

// A PDF of the given number of pages, each carrying about `kilobytes` of its own drawing,
// so the file is big enough to split by size.
export async function makeHeavyPdf(pages: number, kilobytes: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    const page = doc.addPage([200 + index, 300]);
    // Scattered marks in varied colours, so the drawing doesn't compress away. Seeded, so files are the same every run.
    let seed = index + 1;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let mark = 0; mark < kilobytes * 12; mark++) {
      page.drawRectangle({ x: next() * 190, y: next() * 290, width: 1 + next() * 3, height: 1 + next() * 3, color: rgb(next(), next(), next()) });
    }
  }
  return doc.save({ useObjectStreams: false });
}

// The standard 32-byte password padding from the PDF specification.
const PADDING = Buffer.from(
  "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
  "hex",
);

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

const pad = (password: string) => Buffer.concat([Buffer.from(password, "latin1"), PADDING]).subarray(0, 32);
const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();

// A real password-protected PDF (40-bit RC4, revision 2), so both pdf-lib and pdf.js treat it as locked.
export async function makeEncryptedPdf(userPassword = "secret"): Promise<Uint8Array> {
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-44);
  const owner = rc4(md5(pad("owner")).subarray(0, 5), pad(userPassword));
  const key = md5(pad(userPassword), owner, permissions, id).subarray(0, 5);
  const user = rc4(key, PADDING);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 300] >>",
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -44 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> >>`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\n`;
  body += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

export async function pageWidths(bytes: Uint8Array | Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

export async function pageRotations(bytes: Uint8Array | Buffer): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

export async function pageCropBoxes(bytes: Uint8Array | Buffer): Promise<number[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const box = page.getCropBox();
    return [box.x, box.y, box.width, box.height].map((value) => Math.round(value));
  });
}

export async function pageSizes(bytes: Uint8Array | Buffer): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => [Math.round(page.getWidth()), Math.round(page.getHeight())]);
}
