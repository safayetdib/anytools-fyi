import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FontStyle, PageContent, PicturePlace, TextPiece } from "../../lib/pdf/page-content";
import { buildDocx, wordName } from "./docx";
import { layoutPage, type Paragraph } from "./paragraphs";

const plain: FontStyle = { family: "Times New Roman", bold: false, italic: false };
const bold: FontStyle = { ...plain, bold: true };
// About half a point per letter for each point of size, like most fonts.
const piece = (text: string, x: number, baseline: number, size = 12, font = plain): TextPiece => ({ text, x, baseline, width: text.length * size * 0.5, size, font, upright: true });
const page = (pieces: TextPiece[], pictures: PicturePlace[] = [], hiddenText = false): PageContent => ({ width: 612, height: 792, pieces, pictures, hiddenText });
const picture = (x: number, y: number, width: number, height: number, key = "img"): PicturePlace => ({ x, y, width, height, key, draw: async () => null });
const texts = (blocks: ReturnType<typeof layoutPage>["blocks"]) => blocks.map((block) => (block.kind === "text" ? block.runs.map((run) => run.text).join("") : `[${block.place.key}]`));

describe("layoutPage", () => {
  it("joins wrapped lines into paragraphs and ends them where a line stops short", () => {
    const layout = layoutPage(
      page([
        piece("Lease terms", 72, 100, 18, bold),
        // 72 letters fill the line out to 504 points.
        piece("Rent is due on the fifth day of each month, paid by bank transfer to the", 72, 130),
        piece("landlord's account. Late rent costs extra.", 72, 145),
        piece("The deposit is two months' rent, paid back within thirty days of the end", 72, 160),
        piece("of the lease.", 72, 175),
      ]),
    );
    expect(texts(layout.blocks)).toEqual([
      "Lease terms",
      "Rent is due on the fifth day of each month, paid by bank transfer to the landlord's account. Late rent costs extra.",
      "The deposit is two months' rent, paid back within thirty days of the end of the lease.",
    ]);
    const [heading, first] = layout.blocks as Paragraph[];
    expect(heading.runs[0]).toMatchObject({ font: bold, size: 18 });
    expect(first.lineSpacing).toBeCloseTo(15 / (12 * 1.17), 1);
    expect(first.before).toBeGreaterThan(5);
    expect(layout.margins.left).toBe(72);
  });

  it("finds centred and right-aligned lines, indents, lists and tab stops", () => {
    const layout = layoutPage(
      page([
        piece("Invoice", 270, 80, 18),
        piece("Dhaka, 5 May", 468, 110),
        piece("Thank you for your order. It went out today.", 72, 140),
        piece("• Rice", 90, 160),
        piece("• Lentils", 90, 175),
        piece("Rice", 72, 200),
        piece("120.50", 400, 200),
        piece("A long paragraph set in from the left, which", 108, 230),
        piece("wraps onto a second line here at the end.", 108, 245),
      ]),
    );
    const blocks = layout.blocks as Paragraph[];
    expect(texts(blocks)).toEqual([
      "Invoice",
      "Dhaka, 5 May",
      "Thank you for your order. It went out today.",
      "• Rice",
      "• Lentils",
      "Rice\t120.50",
      "A long paragraph set in from the left, which wraps onto a second line here at the end.",
    ]);
    expect(blocks.map((block) => block.align)).toEqual(["center", "right", "left", "left", "left", "left", "left"]);
    expect(blocks[3].indent).toBe(18);
    expect(blocks[5].tabs).toEqual([328]);
    expect(blocks[6].indent).toBe(36);
  });

  it("puts pictures among the paragraphs, and keeps a background behind the text", () => {
    const layout = layoutPage(
      page([piece("Above", 72, 100), piece("Below", 72, 400)], [picture(72, 150, 200, 100, "photo"), picture(0, 0, 612, 792, "letterhead")]),
    );
    expect(texts(layout.blocks)).toEqual(["Above", "[photo]", "Below"]);
    expect(layout.behind.map((place) => place.key)).toEqual(["letterhead"]);
  });

  it("drops the scan behind hidden OCR text, keeping the text to edit", () => {
    const layout = layoutPage(page([piece("Scanned words", 72, 100)], [picture(0, 0, 612, 792, "scan")], true));
    expect(texts(layout.blocks)).toEqual(["Scanned words"]);
    expect(layout.behind).toEqual([]);
  });

  it("joins a word broken across lines", () => {
    const layout = layoutPage(page([piece("These systems are such a suc‐", 72, 100), piece("cessful abstraction.", 72, 114)]));
    expect(texts(layout.blocks)).toEqual(["These systems are such a successful abstraction."]);
  });
});

describe("buildDocx", () => {
  it("writes a Word file with one section for each page, at the page's size", () => {
    const pages = [layoutPage(page([piece("Hello & welcome", 72, 100, 12, bold)])), layoutPage({ ...page([piece("আমার সোনার বাংলা", 72, 100)]), width: 842, height: 595 })];
    const files = unzipSync(buildDocx(pages, new Map(), "Report"));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/settings.xml", "word/styles.xml"]);
    const body = new TextDecoder().decode(files["word/document.xml"]);
    expect(body).toContain('<w:t xml:space="preserve">Hello &amp; welcome</w:t>');
    expect(body).toContain("<w:b/><w:bCs/>");
    // Bangla is set in a Bangla font, marked as Bangla.
    expect(body).toMatch(/w:cs="Nirmala UI"\/><w:sz w:val="24"\/><w:szCs w:val="24"\/><w:lang w:bidi="bn-BD"\/><\/w:rPr><w:t xml:space="preserve">আমার সোনার বাংলা/);
    expect(body.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(body).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(body).toContain('<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"/>');
    expect(new TextDecoder().decode(files["docProps/core.xml"])).toContain("<dc:title>Report</dc:title>");
  });

  it("saves each picture once, however often it's placed", () => {
    const layout = layoutPage(page([piece("Logo", 72, 300)], [picture(72, 50, 100, 50, "logo")]));
    const file = { bytes: new Uint8Array([1, 2, 3]), type: "png" as const, width: 300, height: 150 };
    const files = unzipSync(buildDocx([layout, layout], new Map([["logo", file]]), "Two"));
    expect(Object.keys(files).filter((name) => name.startsWith("word/media/"))).toEqual(["word/media/picture1.png"]);
    const body = new TextDecoder().decode(files["word/document.xml"]);
    expect(body.match(/r:embed="rIdPicture1"/g)).toHaveLength(2);
    // 100 by 50 points, in the units Word measures pictures in.
    expect(body).toContain('<wp:extent cx="1270000" cy="635000"/>');
    expect(wordName("report.PDF")).toBe("report.docx");
  });
});
