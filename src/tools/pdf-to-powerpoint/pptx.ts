import { BANGLA, BANGLA_FONT, XML_HEAD, emu, packOffice, xml } from "../../lib/office/ooxml";
import type { SlideRun, TextBox } from "./slides";

// Writes the PowerPoint file: one slide for each page, the page as a picture with its text in boxes on top.

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const DEFAULT_FONT = "Calibri";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
// PowerPoint allows slides from 1 inch to 56 inches on a side.
const MIN_SIDE = 72;
const MAX_SIDE = 4032;

export interface Slide {
  // The page's size as shown, in points.
  width: number;
  height: number;
  picture: Uint8Array;
  boxes: TextBox[];
}

const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function runXml(run: SlideRun, scale: number): string {
  const family = run.font.family ?? DEFAULT_FONT;
  const bangla = BANGLA.test(run.text);
  const complex = bangla ? BANGLA_FONT : family;
  const size = Math.max(100, Math.round(run.size * scale * 100));
  return (
    `<a:r><a:rPr lang="${bangla ? "bn-BD" : "en-US"}" sz="${size}" b="${run.font.bold ? 1 : 0}" i="${run.font.italic ? 1 : 0}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="${run.colour}"/></a:solidFill>` +
    `<a:latin typeface="${xml(family)}"/><a:cs typeface="${xml(complex)}"/>` +
    `</a:rPr><a:t>${xml(run.text)}</a:t></a:r>`
  );
}

function boxXml(box: TextBox, id: number, place: (x: number, y: number) => [number, number], scale: number): string {
  const [x, y] = place(box.x, box.y);
  const rotation = box.angle ? ` rot="${Math.round((((box.angle % 360) + 360) % 360) * 60000)}"` : "";
  const paragraphs = box.paragraphs
    .map(
      (paragraph) =>
        `<a:p><a:pPr algn="${box.align}"><a:lnSpc><a:spcPct val="${Math.round(box.spacing * 100000)}"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:buNone/></a:pPr>` +
        paragraph.runs.map((run) => runXml(run, scale)).join("") +
        "</a:p>",
    )
    .join("");
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm${rotation}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(box.width * scale)}" cy="${emu(box.height * scale)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${box.fill ? `<a:solidFill><a:srgbClr val="${box.fill}"/></a:solidFill>` : "<a:noFill/>"}</p:spPr>` +
    '<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>' +
    paragraphs +
    "</p:txBody></p:sp>"
  );
}

// One slide. Pages of another shape than the first are scaled to fit and centred.
export function slideXml(slide: Slide, size: { width: number; height: number }): string {
  const scale = Math.min(size.width / slide.width, size.height / slide.height);
  const left = (size.width - slide.width * scale) / 2;
  const top = (size.height - slide.height * scale) / 2;
  const place = (x: number, y: number): [number, number] => [left + x * scale, top + y * scale];
  const picture =
    '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rIdPage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="${emu(left)}" y="${emu(top)}"/><a:ext cx="${emu(slide.width * scale)}" cy="${emu(slide.height * scale)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const boxes = slide.boxes.map((box, index) => boxXml(box, index + 3, place, scale)).join("");
  return `${XML_HEAD}<p:sld ${NS}><p:cSld><p:spTree>${GROUP}${picture}${boxes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME =
  `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements>` +
  '<a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>' +
  `<a:fontScheme name="Office"><a:majorFont><a:latin typeface="${DEFAULT_FONT}"/><a:ea typeface=""/><a:cs typeface="${BANGLA_FONT}"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="${DEFAULT_FONT}"/><a:ea typeface=""/><a:cs typeface="${BANGLA_FONT}"/></a:minorFont></a:fontScheme>` +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
  '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>' +
  "</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";

const MASTER =
  `${XML_HEAD}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP}</p:spTree></p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  '<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles>' +
  "</p:sldMaster>";

const LAYOUT = `${XML_HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const rels = (items: [string, string, string][]) =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") +
  "</Relationships>";

// The whole .pptx file, with every slide the size of the first page.
export function buildPptx(slides: Slide[], title: string): Uint8Array {
  const first = slides[0] ?? { width: 960, height: 540 };
  // Very large or small pages are scaled to fit what PowerPoint allows.
  const fit = Math.min(1, MAX_SIDE / Math.max(first.width, first.height));
  const grow = Math.max(1, MIN_SIDE / Math.min(first.width * fit, first.height * fit));
  const size = { width: first.width * fit * grow, height: first.height * fit * grow };
  const parts: Record<string, string | Uint8Array> = {};
  const overrides: string[] = [];
  const slideIds: string[] = [];
  const presentationRels: [string, string, string][] = [
    ["rId1", `${REL}/slideMaster`, "slideMasters/slideMaster1.xml"],
    ["rId2", `${REL}/theme`, "theme/theme1.xml"],
    ["rId3", `${REL}/presProps`, "presProps.xml"],
    ["rId4", `${REL}/viewProps`, "viewProps.xml"],
    ["rId5", `${REL}/tableStyles`, "tableStyles.xml"],
  ];
  for (const [index, slide] of slides.entries()) {
    const number = index + 1;
    parts[`ppt/slides/slide${number}.xml`] = slideXml(slide, size);
    parts[`ppt/slides/_rels/slide${number}.xml.rels`] = rels([
      ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rIdPage", `${REL}/image`, `../media/page${number}.jpeg`],
    ]);
    parts[`ppt/media/page${number}.jpeg`] = slide.picture;
    overrides.push(`<Override PartName="/ppt/slides/slide${number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`);
    presentationRels.push([`rIdSlide${number}`, `${REL}/slide`, `slides/slide${number}.xml`]);
    slideIds.push(`<p:sldId id="${255 + number}" r:id="rIdSlide${number}"/>`);
  }
  return packOffice({
    "[Content_Types].xml":
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
      '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
      '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
      '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>' +
      '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>' +
      '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      overrides.join("") +
      "</Types>",
    "_rels/.rels": rels([
      ["rId1", `${REL}/officeDocument`, "ppt/presentation.xml"],
      ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
    ]),
    "docProps/core.xml":
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
      `<dc:title>${xml(title)}</dc:title></cp:coreProperties>`,
    "ppt/presentation.xml":
      `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(size.width)}" cy="${emu(size.height)}"/><p:notesSz cx="6858000" cy="9144000"/>` +
      "</p:presentation>",
    "ppt/_rels/presentation.xml.rels": rels(presentationRels),
    "ppt/presProps.xml": `${XML_HEAD}<p:presentationPr ${NS}/>`,
    "ppt/viewProps.xml": `${XML_HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
    "ppt/tableStyles.xml": `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`,
    "ppt/theme/theme1.xml": THEME,
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rId2", `${REL}/theme`, "../theme/theme1.xml"],
    ]),
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([["rId1", `${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]]),
    ...parts,
  });
}

// Like most PDF tools: "deck.pdf" becomes "deck.pptx".
export function powerpointName(original: string): string {
  return `${original.replace(/\.pdf$/i, "") || "presentation"}.pptx`;
}
