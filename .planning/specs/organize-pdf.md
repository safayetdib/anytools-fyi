# Spec: Organize PDF

Status: part of the owner's 2026-11-08 request to add tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed one by one. Sixth tool.

## What iLovePDF does (checked 2026-11-08 with two 12-page files)
- Several PDFs can be added. Every page of every file shows in one grid, tinted by file, and the panel lists the files with letters: "A: report.pdf", "B: second.pdf".
- Hovering a page shows **Zoom**, **Rotate** (a quarter turn clockwise) and **Delete**. A **+** on the page's left edge adds a blank page before it ("Add a blank page").
- Pages are dragged to a new place. **Reset all** puts everything back. A sort button orders pages by number.
- The button is **Organize**. The result is one PDF, `organized.pdf`, with the pages in the new order: deleted pages left out, turned pages turned, blank pages added.

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF.
2. **Organize.** The options panel (right on screens 900 px and wider, first on phones), titled **Organize PDF**:
   - Note: "Drag pages to reorder them. Use the buttons on each page to turn it, delete it or add a blank page before it."
   - **Files**: each file with its letter, like "A: report.pdf", in its colour.
   - **Reset all** appears once something has changed.
   - The grid shows every page as a card: its picture, its label ("A1", "A2", or "1", "2" for one file), and Zoom, Rotate and Delete buttons. A "+" before each page adds a blank page there.
   - Pages are moved by dragging (anywhere on the card with a mouse, by the grip on touch screens), or with Alt and the arrow keys on a focused page.
   - The run button **Organize** is unavailable when every page has been deleted, with the note "Keep at least one page. A PDF can't be empty."
3. **Result.** One `organized.pdf`, with Merge PDF's preview, page editing and Download with changes.

## Rules
- Turns are quarter turns on top of each page's own rotation.
- A blank page takes the size of the page after it (or before it, at the end), as it is shown, so it fits in with its neighbours. With no pages around it, it's A4.
- Pages from the same file can appear in any order; a page can't be used twice.
- At most 2,000 pages in the grid, so phones stay responsive.

## Technical
- `src/tools/organize-pdf/` with a worker using pdf-lib: copy each kept page from its file, add the turn, add blank pages.
- The panel keeps the plan as a list of `{ file, page, rotate }` or `{ blank: true }` and sends it as JSON in a hidden `plan` field.
- Thumbnails are drawn as they scroll into view, from each file opened once with pdf.js.

## Content
- Title: "Organize PDF Pages Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: building the new PDF from a plan (order, turns, blank page sizes, pages from several files), errors naming the file.
- Browser: labels and letters, rotate, delete and Reset all, blank pages, Alt+arrow and drag reordering, the downloaded file's pages, every page deleted, result editing, axe in light and dark, 320, 375, 768 and 1366 px.

## Not in scope
- iLovePDF's "Order pages by number" and "Mix PDF pages" sort buttons: Reset all already restores page-number order. Can be added later.
