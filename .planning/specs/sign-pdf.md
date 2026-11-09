# Spec: Sign PDF (stage 1: upload, clean up, place)

Status: asked for on 2026-11-09: "add signature in which user can upload image of signature and place it in the pdf... option for filter, contrast, color etc. so that user can edit and make the signature prominent". Stage 2 (draw, type, initials, date) comes later if the owner asks.

## What iLovePDF does (checked 2026-11-09)
- One PDF. First asks "Who will sign this document?": **Only me** / Several people (needs an account; out of scope).
- "Set your signature details": Full name, Initials, and tabs Signature / Initials / Company stamp. A signature can be typed (font list), drawn, or uploaded ("Upload signature", PNG, JPG and SVG). Colours: black, red, blue, green.
- **Upload has no editing**: the picture is used as it is, background and all.
- Then pages are shown one at a time with "1 / 2"; a right panel **Signing options** lists Signature (required) and Initials, Name, Date, Text, Company stamp (optional), dragged onto the page. Button **Sign**.

## Where we go further
Photos of signatures on paper have grey paper, shadows and faint ink. We clean them in the browser, live:
- **Filter**: Original (the photo as it is), Clean (paper removed, default), Bold (clean, stronger and thicker).
- **Background removal** slider: how much of the paper and shadows becomes see-through.
- **Contrast** slider: turns faint ink solid.
- **Thickness**: 0 to 3, makes thin strokes bolder.
- **Ink colour**: keep the pen's own colour, or black, blue, red, green, or any colour.
- **Rotate**: a quarter turn, for sideways photos.
- The picture is cropped to the ink automatically.

## Journey
1. **Select.** One PDF, up to 100 MB, like Remove pages.
2. **Sign.** Panel (right on 900 px and wider, first on phones) titled **Signing options**:
   - **Upload signature** (JPG, PNG, WebP, HEIC). The cleaned signature shows on a checkered background so see-through parts are visible.
   - The cleanup controls above.
   - **Add to page N** places the signature on the page most in view; **Add to every page** places it at the same spot on all pages.
   - The pages are shown large, one under another. Each placed signature can be dragged, resized from its corner, removed with its × button, or moved with the keyboard (arrows, Shift for bigger steps, + and − to resize, Delete to remove).
   - The run button **Sign PDF** works once there is at least one signature on a page.
3. **Result.** `agreement_signed.pdf`, with page preview and editing like the other tools.

## Rules
- Everything runs in the browser; nothing is uploaded.
- The signature is drawn into the PDF as a picture (PNG with see-through background), at the place and size shown. Pages turned by the PDF's own rotation are handled.
- The signature picture is kept at most 1,600 px on its longer side, plenty for print.
- A picture where no ink can be found gets a clear message.
- This is a visual signature, not a certificate-based digital signature. The page says so.
- Password-protected and damaged files get the same errors as the other tools.

## Technical
- `clean.ts`: pure pixel work (paper and ink levels from the picture's brightness, removal, contrast, thickness, colour, crop, turn), tested in Node.
- `sign.ts`: pdf-lib, places the PNG using the shared helpers in `src/lib/pdf/stamp.ts`.
- `chosen-signature.ts` keeps the decoded picture and the settings in the page; the run makes the final PNG and sends it to the worker.
- Decoding reuses JPG to PDF's decoder, so HEIC works everywhere.

## Content
- Title: "Sign PDF Online Free: Add Your Signature | AnyTools.fyi" (60 characters or fewer). Meta description, guide (5 steps, limits, tips, 6 FAQs including the digital-signature question), diagram showing a photo being cleaned, share image.
- Registry entry after PDF to JPG, icon, aliases (esign, add signature to pdf, electronic signature, পিডিএফে স্বাক্ষর), related tools.

## Tests
- Unit: settings parsing, paper removed and ink kept, contrast, colour, thickness, crop, turn, no-ink case, placement maths, the PDF gets the image on the right pages, rotated pages, names.
- Browser: upload and preview, controls change the preview, add to a page, drag and resize, keyboard, remove, add to every page, the signed PDF shows ink at the placed spot (checked by rendering it), axe light and dark, 320, 375, 768, 1366 px, Safari.

---

# Stage 2: type, draw, initials and date

Status: asked for on 2026-11-09 ("Build stage 2").

## Following iLovePDF
iLovePDF's signature details have Signature and Initials, each made by **Type** (a name in a choice of handwriting fonts), **Draw** or **Upload**, in black, red, blue or green; a Date can be placed on the page too. We follow that order and add our own photo cleanup to Upload, plus any colour.

## Journey
- The panel starts with **What to add**: Signature, Initials, Date (one at a time; each keeps its own choices).
- **Signature** and **Initials** each have **Type**, **Draw** and **Upload**:
  - **Type**: a text box (your name, or your initials), and font cards showing what you typed in each font: four handwriting fonts and Galada, which also writes Bangla. Bangla names in the other fonts fall back to the device's Bangla font.
  - **Draw**: a pad drawn with finger, mouse or pen; **Pen size** thin, medium or thick; **Clear** and **Undo**. Keyboard users get a note that Type or Upload works without a pointer.
  - **Upload**: stage 1 as it is (filters, sliders, pen colour, rotate, reset).
  - Type and Draw share one **Ink colour** row: black, blue, red, green or any colour.
  - Typing a name for the signature fills the initials with its first letters, until the initials are typed by hand.
- **Date**: a date picker (today by default) and a **Format** choice: 09/11/2026, 11/09/2026, 2026-11-09, 9 November 2026. Same ink colours.
- **Add to page N** and **Add to every page** add the mark chosen in What to add. Every placed mark moves, resizes and is removed the same way as before. Changing a mark (new font, new colour, new date) changes every placed copy of it.
- **Sign PDF** works once something is placed and every placed mark has a picture.

## Rules
- Every mark goes into the PDF as a PNG with a see-through background, cropped to the ink, so typed names in any script look exactly as previewed. The font files stay on the device; nothing is uploaded.
- Fonts are free (SIL Open Font License; Satisfy is Apache 2.0), bundled with the site, credited on the Credits page, and only downloaded when the Type tab is used.
- Drawn strokes are recorded as points and redrawn at full size for the PDF, so they stay sharp.

## Technical
- `sign.ts`: placements gain `mark` (signature, initials, date; old placements without it are signatures). `signPdf` takes one picture per mark and embeds each once.
- `marks.ts` (new, pure): date formats, initials from a name, stroke bounds and scaling, tested in Node.
- `render.ts` (new, page): draws strokes and text onto a canvas and crops to the ink.
- `MarkEditor.astro` (new): the Type, Draw and Upload editor, used for Signature and Initials.
- `chosen-signature.ts` keeps one picture source per mark, which the run turns into full-size PNGs.

## Tests
- Unit: placements with marks, a PDF with signature, initials and date on different pages, each picture embedded once, date formats, initials, stroke maths.
- Browser: type a name, the fonts show it, the preview changes with font and colour; initials follow the name; draw on the pad, undo and clear; date formats; place one of each and the signed file has three different pictures where they were placed; Upload still cleans photos; axe, widths, Safari.
