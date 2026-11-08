# Spec: PDF to JPG

Status: part of the owner's 2026-11-08 request to add tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed one by one. Eighth tool.

## What iLovePDF does (checked 2026-11-09 with a 12-page PDF)
- Several PDFs can be added; each shows as a card with its first page.
- Panel **PDF to JPG options**:
  - **Page to JPG** (default): "Every page of this PDF will be converted into a JPG file. **12** JPG will be created."
  - **Extract images**: "All embedded images inside the PDF will be extracted as JPG images."
  - **Image quality**: **Normal** (marked Recommended, default) / **High**.
- Button **Convert to JPG**. Result: "PDF has been converted to JPG images", **Download JPG images**: `ilovepdf_pages-to-jpg.zip` holding `report_page-0001.jpg`, `report_page-0002.jpg`… Normal is 150 dpi (an A4 page is 1240×1755 px).

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF.
2. **Options.** The panel (right on screens 900 px and wider, first on phones), titled **PDF to JPG options**, with iLovePDF's two modes, their notes (the count in bold, for all files together), and Image quality Normal (Recommended) / High. Each PDF is a card with its first page and page count.
3. **Result.** One JPG is downloaded as it is (`report_page-0001.jpg`). Several come in one ZIP (`anytools_pages-to-jpg.zip`, or `anytools_images-from-pdf.zip` for extracted images), with a card for each picture, its own download, and a larger view.

## Rules
- Normal is 150 dpi, JPG quality 0.85. High is 300 dpi, quality 0.92. Pages are drawn on white, turned the way the PDF shows them.
- Very large pages are drawn smaller so no side is over 4,096 px, which phones can handle.
- Extract images: every picture placed in the PDF is saved once as JPG, at its own size, in the order it first appears; see-through parts become white. Images smaller than 8 px on a side (lines, dots) are skipped. If a PDF has none, the error says so and suggests Page to JPG.
- File names: `report_page-0001.jpg`, `report_image-0001.jpg`, numbered with four digits so they sort in order.
- At most 500 JPGs from one run, so phones don't run out of memory.

## Technical
- `src/tools/pdf-to-jpg/` renders pages with pdf.js in the page, like the previews, and packs ZIPs with the shared helper. Extracted images come from pdf.js's list of drawing steps.
- The shell's previews learn to show image results, so result cards and the larger view work for JPGs.

## Content
- Title: "PDF to JPG Converter Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: names, quality settings, turning raw pixel data into pictures.
- Browser: defaults and the count, one page to one JPG, several pages to a ZIP with the right names and sizes, High quality, extracting images from a PDF with photos, a PDF with none, several PDFs, axe in light and dark, 320, 375, 768 and 1366 px.
