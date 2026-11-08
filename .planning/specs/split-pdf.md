# Spec: Split PDF

Status: approved by the owner on 2026-11-07 (all three split modes; ZIP plus each part). Second live tool. Follows Merge PDF (see [[merge-pdf-is-the-template]]) for workflow, UI, phone layout, guide content, accessibility and test depth. Differences are listed below.

## Goal
Turn one PDF into several smaller PDFs, quickly, on a phone or a computer, without uploading it. Most people split to send one part (a single certificate, one chapter, the pages a form asks for) or to get under an email or upload size limit.

## Journey (follows iLovePDF's split, which people already know)
The owner asked on 2026-11-08 to follow iLovePDF's options and flow (https://www.ilovepdf.com/split_pdf), so this replaces the earlier scissors design.

1. **Select.** One PDF, up to 100 MB. Password-protected and broken files are flagged at once, as in Merge PDF. Removing the file goes back to Select.
2. **Choose how to split.** An options panel with three tabs. On screens 900 px and wider it sits on the right of the page previews, like iLovePDF; on phones it comes first, above the previews.
   - **Range**, with a Range mode switch:
     - **Custom** (default): a list of ranges, "Range 1", "Range 2"…, each with *from page* and *to page* number fields and a remove button. **Add range** adds the next one, starting after the last. Checkbox **Merge all ranges in one PDF file**. Preview: each range is a dashed box labelled "Range 1", with its first page, "…", and its last page.
     - **Fixed**: "Split into page ranges of [N]" pages. Info: "This PDF will be split into files of N pages. X PDFs will be created." Preview: the same range boxes.
   - **Pages**, with an Extract mode switch:
     - **Extract all pages** (default): info "Every page will become a separate PDF. X PDFs will be created." Preview: every page with a tick.
     - **Select pages**: tap pages to tick or untick them, or type them in **Pages to extract**, like `1,5-8`; both stay in sync. Checkbox **Merge extracted pages into one PDF file**. Info says how many PDFs that makes.
   - **Size**: shows the original file size and page count; **Maximum size per file** with a KB/MB switch. Info: "This PDF will be split into files no larger than N each." Preview: the file's first page. iLovePDF's paid "Allow compression" and AI "Smart" mode are left out.
   The run button says **Split PDF**.
3. **Result.** Same as before: when several PDFs are made, the result card says "Your N files are ready" with **Download** of the ZIP on the right, and each part is listed as a card with its first page, pages and size, its own download and a page-by-page preview. When one PDF is made (merged ranges, or a single range), the result works exactly like Merge PDF's, with page editing and Download with changes.

## Rules
- Page numbers are 1-based. Ranges may overlap: each range is its own file. A *from* larger than *to*, or a page past the end, is explained next to the field.
- Typed page lists accept spaces, `–` and `-`, and `5-` meaning "5 to the end". Repeated pages are counted once.
- At most 300 PDFs from one split.
- Size splitting keeps pages in order and never splits a page. A page that is bigger than the limit on its own becomes its own file, and the summary says so.
- File names: ranges `report-pages-1-3.pdf`; fixed and size `report-1.pdf`; single pages `report-page-4.pdf`; merged `report-extracted.pdf`.
- Thumbnails load as they scroll into view, in the preview and in the result, so a 300-page file doesn't freeze a phone.
- Parts keep the original page size, rotation, links and form fields that pdf-lib can copy.

## Phone layout
- Same app layout as Merge PDF: step bar and docked action bar. Tabs and switches are full-width, with 44 px targets.

## Technical
- Splitting runs in a Web Worker with pdf-lib, like merging.
- The ZIP is made in the browser with `fflate` (MIT, about 8 KB gzipped), stored without extra compression, because PDFs are already compressed. Credit it on the credits page.
- New shell pieces stay generic, so Remove pages, Extract pages and Organize PDF can reuse them: a page preview for one file (range boxes, or every page with ticks), and a "parts" result view.

## Content
- Title: "Split PDF Online Free, No Upload | AnyTools.fyi"; meta description, guide (how-to steps, limits, tips, 5 FAQs), diagram and share image, all in Merge PDF's style.
- Launch checklist from [[merge-pdf-is-the-template]]: `built: true`, sitemap, llms.txt, search, menu, homepage, related tools.

## Tests
- Unit: page lists and ranges (every form above and every error), part planning for each mode, size splitting, file naming, the split itself on generated PDFs.
- Browser: every tab and mode, ticks and typed pages staying in sync, add and remove ranges, merge checkboxes, 1-page and 300-page files, password-protected and broken files, ZIP contents, single-part result with editing, keyboard-only use, axe in light and dark, phone 320/375, tablet 768, desktop 1366.

## Not in scope
- Compression while splitting, AI "Smart" splitting, splitting by bookmarks, or several files at once.

## Build plan
1. Split rules for ranges, page lists, fixed groups and size, test-first.
2. Page preview (range boxes and ticked pages) and the tabbed options panel.
3. Lazy part thumbnails in the result.
4. Strings, guide, diagram and share image; browser tests at every width, axe in both themes; launch checklist.
