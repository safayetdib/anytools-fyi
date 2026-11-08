# Spec: Add watermark

Status: part of the owner's 2026-11-08 request to add tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed one by one. Tenth and last of the Core 10.

## What iLovePDF does (checked 2026-11-09 with a 12-page PDF, at /pdf_add_watermark)
- Several PDFs can be added. Every page shows with a dot where the watermark goes.
- Panel **Watermark options** with two tabs:
  - **Place text** (default): **Text** ("iLovePDF"), **Text format** (font, size 14, bold, italic, underline, colour), as in Add page numbers.
  - **Place image**: choose an image instead of text.
- Both: **Position** on a 3×3 grid (top left by default) and **Mosaic** (repeat it across the page); **Transparency**: No transparency / 75% / 50% / 25%; **Rotation**: Do not rotate / 45 / 90 / 180 / 270 degrees; **Pages** from page 1 to the last; **Layer**: Over the PDF content (default) / Below the PDF content.
- Button **Add watermark**. Result: `report_watermark.pdf`.

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF.
2. **Options.** The panel (right on screens 900 px and wider, first on phones), titled **Watermark options**, with iLovePDF's tabs, options and defaults. The pages of the first file show beside it with the watermark drawn on, in its text or image, size, colour, transparency, rotation and spot, updating as options change.
3. **Result.** One file: `report_watermark.pdf`, with Merge PDF's preview and page editing. Several: `anytools_watermark.zip` with a card for each.

## Differences from iLovePDF
- The text starts as **CONFIDENTIAL**, not our brand, so a document is never stamped with the site's name by accident.
- Fonts: Helvetica, Times and Courier, the fonts every PDF reader has built in, as in Add page numbers. Text uses Latin letters, digits and common symbols; anything else is explained before running.
- Place image takes JPG, PNG, WebP or GIF. See-through parts of PNG logos stay see-through.

## Rules
- Transparency is how see-through the watermark is: 75% transparent draws it at 25% strength.
- Rotation turns the watermark anticlockwise around its own centre, so 45 degrees runs up to the right, the usual diagonal stamp; it stays inside the margins at its spot.
- Mosaic repeats the watermark in rows and columns across the whole page, ignoring the position.
- Positions keep an 18 pt margin from the edges. Watermarks are placed as the page is shown, so turned pages are stamped upright.
- An image is placed at its own size (96 dpi), shrunk to fit if it's larger than half the page.
- Below the PDF content draws the watermark first, so the page's text and pictures sit on top. On scanned pages, the scan may hide it, as in other tools.

## Technical
- `src/tools/add-watermark/` with a worker using pdf-lib. Page placement helpers shared with Add page numbers move to `src/lib/pdf/stamp.ts`.
- The live preview uses the page grid's overlay layer.

## Content
- Title within 60 characters. Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: settings, positions with rotation, mosaic tiles, transparency, below-content order, turned pages, images, refusing text the fonts can't draw.
- Browser: defaults, the preview following options, text and image watermarks in the downloaded file, several files as a ZIP, result editing, axe in light and dark, 320, 375, 768 and 1366 px.
