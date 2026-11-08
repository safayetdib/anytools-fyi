# Spec: Extract PDF pages

Status: the owner said "Start Extract pages" on 2026-11-08, with the standing rule to follow iLovePDF's flow. Fourth live tool.

## What iLovePDF does (checked 2026-11-08)
- There is no separate Extract pages tool: `/extract-pages` is a 404.
- Their menu's **Extract pages** link opens Split PDF at `/split_pdf#split,extract`. With a file added, the **Split** panel opens on the **Pages** tab with **Extract all pages** chosen: "Selected pages will be converted into separate PDF files. 12 PDF will be created."
- The other tabs (Range, Size) are still there, and everything else is Split PDF.

## Journey
Same as Split PDF (see `.planning/specs/split-pdf.md`), with these differences:
- Its own page, `/extract-pdf-pages/`, titled **Extract PDF pages**, with its own guide, FAQ, diagram, share image and search words. It stays a listed tool in the PDF tools grid.
- The panel opens on **Pages → Extract all pages**, like iLovePDF's Extract pages link. **Select pages** and **Merge extracted pages into one PDF file** work exactly as in Split PDF.
- The run button says **Extract pages**, so it matches the page's heading. (iLovePDF keeps "Split PDF" because their link lands on the Split PDF page.)
- Results, file names (`report-7.pdf`, `report-extracted.pdf`, `report-split.zip`), errors and limits are Split PDF's.

## Technical
- `src/tools/extract-pdf-pages/` reuses Split PDF's tool definition and options panel. Split's `Options.astro` takes a `start` tab.
- Only the page, strings, guide, diagram and tests are new.

## Content
- Title: "Extract PDF Pages Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image in Merge PDF's style.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Browser: opens on Pages with Extract all pages and the count; Select pages with merge makes one `report-extracted.pdf` with the right pages; without merge, a ZIP of single pages; the other tabs still work; the run button label; axe in light and dark; 320, 375, 768 and 1366 px.
- Unit: registry and search updates.
