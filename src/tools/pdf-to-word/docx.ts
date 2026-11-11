import { BANGLA, BANGLA_FONT, XML_HEAD, emu, packOffice, twips, xml } from "../../lib/office/ooxml";
import type { PictureFile, PicturePlace } from "../../lib/pdf/page-content";
import type { PageLayout, Paragraph, Run } from "./paragraphs";

// Writes the Word file: one section for each PDF page, at the page's own size.

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const DEFAULT_FONT = "Calibri";

function runXml(run: Run): string {
  const family = run.font.family ?? DEFAULT_FONT;
  const bangla = BANGLA.test(run.text);
  // Word sets Bangla in the complex script font; a Latin-only font can't draw it.
  const complex = bangla && !/bengali|bangla|kalpurush|solaiman|siyam|nikosh|vrinda|nirmala|shonar|mukti|lohit|hind siliguri|baloo da/i.test(family) ? BANGLA_FONT : family;
  const size = Math.max(2, Math.round(run.size * 2));
  const props =
    `<w:rPr><w:rFonts w:ascii="${xml(family)}" w:hAnsi="${xml(family)}" w:cs="${xml(complex)}"/>` +
    (run.font.bold ? "<w:b/><w:bCs/>" : "") +
    (run.font.italic ? "<w:i/><w:iCs/>" : "") +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` +
    (bangla ? '<w:lang w:bidi="bn-BD"/>' : "") +
    "</w:rPr>";
  return run.text
    .split("\t")
    .map((part, index) => `<w:r>${props}${index ? "<w:tab/>" : ""}${part ? `<w:t xml:space="preserve">${xml(part)}</w:t>` : ""}</w:r>`)
    .join("");
}

function paragraphProps(paragraph: Paragraph | null, extra = ""): string {
  if (!paragraph) return `<w:pPr><w:spacing w:before="0" w:after="0"/>${extra}</w:pPr>`;
  const tabs = paragraph.tabs.length ? `<w:tabs>${paragraph.tabs.map((pos) => `<w:tab w:val="left" w:pos="${twips(pos)}"/>`).join("")}</w:tabs>` : "";
  const first = paragraph.firstLine < 0 ? `w:hanging="${twips(-paragraph.firstLine)}"` : `w:firstLine="${twips(paragraph.firstLine)}"`;
  return (
    "<w:pPr>" +
    tabs +
    `<w:spacing w:before="${twips(paragraph.before)}" w:after="0" w:line="${Math.round(paragraph.lineSpacing * 240)}" w:lineRule="auto"/>` +
    `<w:ind w:left="${twips(paragraph.indent)}" w:right="${twips(paragraph.rightIndent)}" ${first}/>` +
    `<w:jc w:val="${paragraph.align}"/>` +
    extra +
    "</w:pPr>"
  );
}

export interface DocxPicture {
  file: PictureFile;
  id: string;
  path: string;
}

function graphic(picture: DocxPicture, id: number, width: number, height: number): string {
  return (
    `<wp:docPr id="${id}" name="Picture ${id}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${picture.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    "</pic:pic></a:graphicData></a:graphic>"
  );
}

function sectionXml(page: PageLayout): string {
  const { margins } = page;
  const landscape = page.width > page.height ? ' w:orient="landscape"' : "";
  return (
    `<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${landscape}/>` +
    `<w:pgMar w:top="${twips(margins.top)}" w:right="${twips(margins.right)}" w:bottom="${twips(margins.bottom)}" w:left="${twips(margins.left)}" w:header="0" w:footer="0" w:gutter="0"/>` +
    "</w:sectPr>"
  );
}

// The document's body. `pictures` holds each placed picture's saved file, by its key.
export function documentXml(pages: PageLayout[], pictures: Map<string, DocxPicture>): string {
  let drawingId = 0;
  const body: string[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const lastPage = pageIndex === pages.length - 1;
    const paragraphs: { props: Paragraph | null; content: string }[] = [];
    // Pictures behind the text are held by the page's first paragraph, at their places on the page.
    const behind = page.behind
      .map((place: PicturePlace) => {
        const picture = pictures.get(place.key);
        if (!picture) return "";
        const id = ++drawingId;
        return (
          '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
          '<wp:simplePos x="0" y="0"/>' +
          `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(place.x)}</wp:posOffset></wp:positionH>` +
          `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(place.y)}</wp:posOffset></wp:positionV>` +
          `<wp:extent cx="${emu(place.width)}" cy="${emu(place.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
          graphic(picture, id, place.width, place.height) +
          "</wp:anchor></w:drawing></w:r>"
        );
      })
      .join("");
    for (const block of page.blocks) {
      if (block.kind === "text") {
        paragraphs.push({ props: block, content: block.runs.map(runXml).join("") });
        continue;
      }
      const picture = pictures.get(block.place.key);
      if (!picture) continue;
      const id = ++drawingId;
      const inline =
        `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(block.width)}" cy="${emu(block.height)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
        graphic(picture, id, block.width, block.height) +
        "</wp:inline></w:drawing></w:r>";
      paragraphs.push({
        props: { kind: "text", runs: [], align: "left", indent: block.indent, firstLine: 0, rightIndent: 0, before: block.before, lineSpacing: 1, tabs: [] },
        content: inline,
      });
    }
    // A page with nothing on it still needs a paragraph to hold its place.
    if (!paragraphs.length) paragraphs.push({ props: null, content: "" });
    paragraphs[0].content = behind + paragraphs[0].content;
    for (const [index, paragraph] of paragraphs.entries()) {
      // Each page's own size and margins end its last paragraph; the very last page's go at the end of the body.
      const ends = index === paragraphs.length - 1 && !lastPage;
      body.push(`<w:p>${paragraphProps(paragraph.props, ends ? sectionXml(page) : "")}${paragraph.content}</w:p>`);
    }
  }
  const lastPage = pages[pages.length - 1];
  return `${XML_HEAD}<w:document ${NS}><w:body>${body.join("")}${lastPage ? sectionXml(lastPage) : ""}</w:body></w:document>`;
}

const STYLES =
  `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${DEFAULT_FONT}" w:hAnsi="${DEFAULT_FONT}" w:eastAsia="${DEFAULT_FONT}" w:cs="${BANGLA_FONT}"/>` +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="bn-BD"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  "</w:styles>";

const SETTINGS =
  `${XML_HEAD}<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  '<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>' +
  "</w:settings>";

// The whole .docx file.
export function buildDocx(pages: PageLayout[], pictures: Map<string, PictureFile>, title: string): Uint8Array {
  const saved = new Map<string, DocxPicture>();
  const media: Record<string, Uint8Array> = {};
  let count = 0;
  for (const [key, file] of pictures) {
    count++;
    const path = `media/picture${count}.${file.type === "png" ? "png" : "jpeg"}`;
    saved.set(key, { file, id: `rIdPicture${count}`, path });
    media[`word/${path}`] = file.bytes;
  }
  const relationships = [...saved.values()]
    .map((picture) => `<Relationship Id="${picture.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${picture.path}"/>`)
    .join("");
  return packOffice({
    "[Content_Types].xml":
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      "</Types>",
    "_rels/.rels":
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      "</Relationships>",
    "docProps/core.xml":
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${xml(title)}</dc:title></cp:coreProperties>`,
    "word/_rels/document.xml.rels":
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      relationships +
      "</Relationships>",
    "word/document.xml": documentXml(pages, saved),
    "word/styles.xml": STYLES,
    "word/settings.xml": SETTINGS,
    ...media,
  });
}

// Like most PDF tools: "report.pdf" becomes "report.docx".
export function wordName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "document"}.docx`;
}
