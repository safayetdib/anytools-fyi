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
