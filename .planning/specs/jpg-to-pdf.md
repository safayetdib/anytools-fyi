# Spec: JPG to PDF

Status: part of the owner's 2026-11-08 request to add tools one by one, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed one by one. Seventh tool.

## What iLovePDF does (checked 2026-11-09 with a tall and a wide JPG)
- Accepts `.jpg, .jpeg, .png, .tif, .tiff`, several at once. Each image shows as a card with a page preview; hovering shows **Rotate** and **Remove**. A button sorts files by name.
- Panel **Image to PDF options**:
  - **Page orientation**: Portrait (default) / Landscape.
  - **Page size**: Fit (Same page size as image) / A4 (297x210 mm, default) / US Letter (215x279.4 mm).
  - **Margin**: No margin (default) / Small / Big.
  - **Merge all images in one PDF file**, ticked by default.
- Button **Convert to PDF**. Result: "The images have been converted to PDF", one PDF named after the first image (`tall.pdf`). With Fit, each page is the image's size at 96 dpi (600 px is 450 pt).
- Their fault, which we don't copy: Page orientation stays clickable with Fit, where it does nothing.

## Journey
1. **Select.** One or more images: JPG, PNG, WebP, GIF and BMP, plus HEIC where the browser can open it (Safari). TIFF isn't supported by browsers, so it's left out and the guide says so. Up to 50 MB each. The order of the file list is the page order, as in Merge PDF.
2. **Options.** The panel (right on screens 900 px and wider, first on phones), titled **Image to PDF options**, with iLovePDF's options and defaults. Orientation is unavailable while Page size is Fit, with a short note. Each image is a card showing its page as it will look, with a rotate button.
3. **Result.** Merged: one PDF named after the first image, with Merge PDF's preview and page editing. Not merged: one PDF per image, named after each image, in `anytools_images.zip`, with a card for each.

## Rules
- Photos from phones are turned the way they're shown (EXIF orientation), so they never come out sideways.
- JPG and PNG are placed as they are, without re-compressing. Other formats, and JPGs that need turning, are converted in the browser first (PNG when they have see-through parts, JPG otherwise).
- A4 and Letter: the image is scaled to fit inside the margins and centred. Fit: the page is the image's size at 96 dpi plus the margins.
- Margins: Small is 20 pt (about 7 mm), Big is 50 pt (about 18 mm).

## Technical
- `src/tools/jpg-to-pdf/` with a worker using pdf-lib. Images are prepared in the page (decoding needs the browser), then placed in the worker.
- The shell's file previews show a thumbnail of each image.

## Content
- Title: "JPG to PDF Converter Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: EXIF orientation, page layout for every size, orientation and margin, turning, building PDFs from JPG and PNG, file names.
- Browser: defaults, each option changing the cards, Fit disabling orientation, rotate, merged and separate downloads, page sizes in the files, a phone photo with EXIF, PNG and WebP, axe in light and dark, 320, 375, 768 and 1366 px.
