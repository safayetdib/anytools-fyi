# Spec: Rotate PDF

Status: the owner asked on 2026-11-08 to add more tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, and committed one by one. Fifth tool.

## What iLovePDF does (checked 2026-11-08 with two 12-page files)
- Several PDFs can be added. Each file shows as a card with its first page and name. Hovering a card shows zoom, rotate (a quarter turn clockwise) and remove.
- Panel **Rotate PDF** with the note "Mouse over PDF file below and a ↻ icon will appear, click on the arrows to rotate PDFs."
- **Rotation: RIGHT / LEFT** turns every file a quarter turn. **Reset all** puts them back.
- With two or more files, **Select files to rotate: All / Portrait / Landscape** appears, so Right and Left can turn only the upright or only the sideways files.
- The whole file turns: every page gets the same extra turn.
- Result: "PDF files have been rotated!" with one download. One file is `report_rotated.pdf`; several are a ZIP `ilovepdf_rotated.zip` holding `report_rotated.pdf`, `second_rotated.pdf`.
- Their fault, which we don't copy: Rotate PDF runs even when nothing is turned, and returns unchanged files named "_rotated".

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF (Add more files works).
2. **Rotate.** The options panel (right on screens 900 px and wider, first on phones), titled **Rotate PDF**:
   - Note: "Select the rotate button on a file to turn it, or turn every file at once."
   - With two or more files: **Select files to rotate** with **All**, **Portrait** and **Landscape**, as radio cards like Split PDF's tabs.
   - **Rotation**: **Right** and **Left** buttons turn the chosen files a quarter turn. **Reset all** appears once something is turned.
   - Each file is a card with its first page, its name and a rotate button. The page picture turns to show the new direction.
   - The run button **Rotate PDF** is unavailable until a file is turned.
3. **Result.** One file: `report_rotated.pdf`, with Merge PDF's preview and page editing. Several files: "Your N files are ready" with a ZIP `anytools_rotated.zip`, and a card for each file with its own download. Files that weren't turned are left out, and the summary says so.

## Rules
- Turns are quarter turns. Right adds 90° clockwise, Left 90° anticlockwise; four turns come back to the start.
- Each page keeps its own rotation and gets the extra turn on top, so mixed pages stay correct relative to each other.
- Portrait and Landscape go by each file's first page as it is shown before turning (square counts as portrait).

## Technical
- `src/tools/rotate-pdf/` with a worker using pdf-lib's page rotation, and the shared ZIP helper (`src/lib/zip.ts`).
- The options panel keeps each file's turn and sends them to the run as JSON in a hidden `rotations` field, in the file list's order.

## Content
- Title: "Rotate PDF Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: turning angles, applying turns to every page on top of their own, naming, skipping unturned files.
- Browser: card rotate button, Right and Left on all, Portrait and Landscape filters, Reset all, the run button state, one file's download with every page turned, several files as a ZIP with only turned files, result editing, axe in light and dark, 320, 375, 768 and 1366 px.
