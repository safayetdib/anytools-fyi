import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { FontStyle, PageContent, TextPiece } from "../../lib/pdf/page-content";
import { buildPptx, powerpointName } from "./pptx";
import { textBoxes } from "./slides";

const plain: FontStyle = { family: "Arial", bold: false, italic: false };
const bold: FontStyle = { ...plain, bold: true };
const piece = (text: string, x: number, baseline: number, size = 12, font = plain, angle = 0): TextPiece => ({
  text,
  x,
  baseline,
  width: text.length * size * 0.5,
  size,
  font,
  upright: angle === 0,
  angle,
});
const page = (pieces: TextPiece[], hiddenText = false): PageContent => ({ width: 960, height: 540, pieces, pictures: [], hiddenText });
const white = () => "FFFFFF";

describe("textBoxes", () => {
  it("keeps each block of text in its own box, line by line, in its colour", () => {
    const boxes = textBoxes(page([piece("Our plan", 60, 80, 36, bold), piece("Grow to three cities", 60, 200), piece("by the end of the year", 60, 215)]), white);
    expect(boxes).toHaveLength(2);
    expect(boxes[0].paragraphs.map((p) => p.runs.map((run) => run.text).join(""))).toEqual(["Our plan"]);
    expect(boxes[0].paragraphs[0].runs[0]).toMatchObject({ size: 36, colour: "FFFFFF", font: bold });
    expect(boxes[1].paragraphs.map((p) => p.runs.map((run) => run.text).join(""))).toEqual(["Grow to three cities", "by the end of the year"]);
    expect(boxes[1].x).toBe(60);
    // Room for the letters above the first line, and a little extra width for wider fonts.
    expect(boxes[1].y).toBeLessThan(200 - 12 * 0.9);
    expect(boxes[1].width).toBeGreaterThan(22 * 6);
    expect(boxes[1].spacing).toBeCloseTo(15 / (12 * 1.2), 1);
  });

  it("gives each cell of a table row its own box, and turns turned text", () => {
    const boxes = textBoxes(page([piece("Dhaka", 60, 300), piece("120", 400, 300), piece("Sideways", 900, 400, 12, plain, -90)]), white);
    expect(boxes.map((box) => [box.paragraphs[0].runs[0].text, Math.round(box.x), box.angle])).toEqual([
      ["Dhaka", 60, 0],
      ["120", 400, 0],
      ["Sideways", expect.any(Number), -90],
    ]);
  });

  it("fills boxes with the paper's colour over a scan with hidden OCR text", () => {
    const [box] = textBoxes(page([piece("Scanned words", 60, 100)], true), white, () => ({ paper: "F4F1E8", ink: "222222" }));
    expect(box.fill).toBe("F4F1E8");
    expect(box.paragraphs[0].runs[0].colour).toBe("222222");
  });
});

describe("buildPptx", () => {
  it("writes one slide for each page, the size of the first, with the page behind its text", () => {
    const boxes = textBoxes(page([piece("Hello & welcome", 60, 80, 24, bold), piece("আমার সোনার বাংলা", 60, 200)]), () => "1F4E79");
    const picture = new Uint8Array([0xff, 0xd8, 0xff]);
    const files = unzipSync(buildPptx([{ width: 960, height: 540, picture, boxes }, { width: 595, height: 842, picture, boxes: [] }], "Deck"));
    expect(Object.keys(files).filter((name) => name.startsWith("ppt/slides/slide"))).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
    expect(Object.keys(files).filter((name) => name.startsWith("ppt/media/"))).toEqual(["ppt/media/page1.jpeg", "ppt/media/page2.jpeg"]);
    const presentation = new TextDecoder().decode(files["ppt/presentation.xml"]);
    expect(presentation).toContain('<p:sldSz cx="12192000" cy="6858000"/>');
    const slide = new TextDecoder().decode(files["ppt/slides/slide1.xml"]);
    expect(slide).toContain("<a:t>Hello &amp; welcome</a:t>");
    expect(slide).toContain('sz="2400" b="1" i="0"');
    expect(slide).toContain('<a:srgbClr val="1F4E79"/>');
    expect(slide).toMatch(/lang="bn-BD"[^>]*><a:solidFill><a:srgbClr val="1F4E79"\/><\/a:solidFill><a:latin typeface="Arial"\/><a:cs typeface="Nirmala UI"\/>/);
    // The page's picture comes first, so the text sits on top of it.
    expect(slide.indexOf("<p:pic>")).toBeLessThan(slide.indexOf("<p:sp>"));
    // A tall page on a wide slide is scaled to fit and centred.
    const tall = new TextDecoder().decode(files["ppt/slides/slide2.xml"]);
    const scale = 540 / 842;
    expect(tall).toContain(`<a:ext cx="${Math.round(595 * scale * 12700)}" cy="6858000"/>`);
    expect(powerpointName("pitch.PDF")).toBe("pitch.pptx");
  });
});
