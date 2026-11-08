# Spec: Remove PDF pages

Status: the owner said "go on. always try to follow ilovepdf features flow" on 2026-11-08. Third live tool. Follows Merge PDF (see [[merge-pdf-is-the-template]]) for the shell, phone layout, guide content, accessibility and test depth, and iLovePDF's Remove pages (https://www.ilovepdf.com/remove-pages) for options and flow. Reuses Split PDF's one-file page grid and options panel layout.

## What iLovePDF does (checked 2026-11-08 with a 12-page file)
- Select one PDF. Every page is shown as a thumbnail; a panel on the right is titled **Remove pages**.
- An info note: "Click on pages to remove from document. You can use "shift" key to set ranges."
- **Total pages: 12**, then **Pages to remove:** with the placeholder "example: 1,5-8".
- Clicking a page marks it for removal: it fades and a red ✕ covers it. Clicking it again puts it back. The box follows the clicks ("2,7"). Shift-click marks every page between the last one and this one.
- Each page has a zoom button.
- The **Remove pages** button is faded until a page is marked.
- Result: "PDF pages have been removed." with **Download PDF**. The file is named `report_removed.pdf`.
- Their faults, which we don't copy: the box accepts letters, typing only ever adds pages and never un-marks them, and marking every page lets you run it and then fails with a misleading "file is damaged" error.

## Journey
1. **Select.** One PDF, up to 100 MB. Password-protected and broken files are flagged at once, as in Merge PDF.
2. **Choose pages.** The options panel (right on screens 900 px and wider, first on phones), titled **Remove pages**:
   - Info note: "Select the pages you want to remove. Hold Shift to select a range."
   - **Total pages: N**
   - **Pages to remove**, placeholder "example: 1,5-8". Only digits, commas and dashes can be typed. Typing and tapping stay in sync both ways: typing marks and unmarks pages, tapping rewrites the box.
   - Every page in the grid is a toggle button. Marked pages fade and show a red ✕. Shift-click marks the whole run from the last page tapped. The magnifier opens the page larger, as in Split PDF.
   - The run button **Remove pages** is unavailable until at least one page is marked.
   - Marking every page shows "Keep at least one page. A PDF can't be empty." and the button stays unavailable.
3. **Result.** One file, `report_removed.pdf`. The result card says the file is ready, with Download on the right. The result works like Merge PDF's: page preview, page editing and Download with changes.

## Rules
- Page numbers are 1-based. Typed lists accept `1,5-8`, `–` as well as `-`, and `8-` meaning "8 to the end". Pieces that don't fit the file are skipped, as in Split PDF.
- The new file keeps the original page size and rotation, and the document's own details (title, author). Removing pages uses pdf-lib's `removePage`, so the remaining pages are kept exactly.
- Summary: "Done. Removed 2 pages from report.pdf. report_removed.pdf has 10 pages (4 KB)."

## Technical
- Shared page-list parsing moves to `src/lib/pdf/page-list.ts`, used by Split PDF and Remove pages.
- The page grid gains a "remove" look (faded page and ✕ instead of a tick) and passes Shift to the tool.
- Work runs in a Web Worker with pdf-lib: a `remove` job and the shared `rearrange` job for page editing.

## Content
- Title: "Remove PDF Pages Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image in Merge PDF's style.
- Launch checklist from [[merge-pdf-is-the-template]]: `built: true`, sitemap, llms.txt, search, menu, homepage, related tools, share image.

## Tests
- Unit: page-list parsing (moved, still passing), removing pages from generated PDFs, keeping at least one page, naming.
- Browser: tap to mark and unmark, Shift ranges, typing syncs both ways, letters dropped, every page marked blocked, the run button state, the downloaded file's pages, result editing, password-protected files, keyboard use, axe in light and dark, phone 375 and desktop 1366.

## Not in scope
- Several files at once, or removing blank pages automatically.
