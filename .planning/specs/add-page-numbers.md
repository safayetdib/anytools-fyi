# Spec: Add page numbers

Status: part of the owner's 2026-11-08 request to add tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed one by one. Ninth tool.

## What iLovePDF does (checked 2026-11-09 with a 12-page PDF)
- Several PDFs can be added. Every page shows with a dot where its number will go.
- Panel **Page Number options**:
  - **Page mode**: Single page (default) / Facing pages. Facing pages adds **First page is cover page**, and puts numbers on the outer edge: page 1 on the left, page 2 on the right (with a cover, page 1 stands alone on the right).
  - **Position**: a 3×3 grid, bottom right by default. **Margin**: Small / Recommended (default) / Big.
  - **First number** (1). **Which pages do you want to number?** from page (1) to (last).
  - **Text**: Insert only page number (recommended) / Page {n} / Page {n} of {p} / Custom, with a box for custom text like "Page {n} of {p}".
  - **Text format**: font (Arial, Impact, Verdana, Courier, Comic, Times New Roman and others), size (14), bold, italic, underline, colour (black).
- Button **Add page numbers**. Result: "The PDF has page numbers now!", `report_pagenumber.pdf`. The number sits about 15 to 18 pt from the bottom and right edges at Recommended.

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF.
2. **Options.** The panel (right on screens 900 px and wider, first on phones), titled **Page number options**, with every iLovePDF option and default above. The pages of the first file show beside it, each with its number drawn where it will go, in the chosen text, so changes are visible at once.
3. **Result.** One file: `report_pagenumber.pdf`, with Merge PDF's preview and page editing. Several: `anytools_page-numbers.zip` with a card for each.

## Differences from iLovePDF
- Fonts: the three fonts every PDF reader has built in, named honestly: **Helvetica** (like Arial), **Times** (like Times New Roman) and **Courier**. Others would mean bundling font files and their licences; they can come later.
- Custom text uses Latin letters, digits and common symbols (what those fonts can draw). Other scripts, such as Bangla, are explained in an error before anything runs.

## Rules
- `{n}` is the page's number; `{p}` is the last number printed, so "Page 3 of 11" stays true when the first pages aren't numbered.
- Numbers start at First number on "from page" and count up to "to". Pages outside that range are left as they are.
- Margins: Small 10 pt, Recommended 18 pt, Big 36 pt from the page edge.
- Numbers are placed as the page is shown: on a turned page they're still upright at the chosen corner.
- The text stays as real text in the PDF, so it's sharp at any zoom and can be searched.

## Technical
- `src/tools/add-page-numbers/` with a worker using pdf-lib's built-in fonts. The page grid learns to draw a small layer over each page for the live preview.

## Content
- Title: "Add Page Numbers to PDF Online Free | AnyTools.fyi" (the no-upload promise is in the description, to keep within 60 characters). Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: text templates, positions for all nine cells and three margins, turned pages, facing pages with and without a cover, page ranges and first number, colours, fonts, refusing text the fonts can't draw.
- Browser: defaults, the live preview following each option, the downloaded PDF's text and where it sits, several files as a ZIP, result editing, axe in light and dark, 320, 375, 768 and 1366 px.
