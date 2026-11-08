# Spec: Compress PDF

Status: asked for on 2026-11-09 ("go on" after Compress PDF was recommended as the next tool). Built like the other tools, following iLovePDF, tested on desktop, tablet and mobile, with full SEO, committed on its own.

## What iLovePDF does (checked 2026-11-09)
- Several PDFs can be added; each shows as a card.
- Panel **Compression level** with three cards:
  - **Extreme compression**: "Less quality, high compression"
  - **Recommended compression** (default): "Good quality, good compression"
  - **Less compression**: "High quality, less compression"
- Button **Compress PDF**. The result says how much smaller the file is, with the size before and after.

## Journey
1. **Select.** One or more PDFs, up to 100 MB each, added like Merge PDF.
2. **Options.** The panel (right on screens 900 px and wider, first on phones), titled **Compression level**, with iLovePDF's three cards and notes. Each PDF is a card with its first page and its size.
3. **Result.** One PDF is downloaded as it is (`report_compressed.pdf`), with page preview and editing like the other tools. Several come in one ZIP (`anytools_compressed.zip`) with a card for each. The summary says how much smaller, for example "report.pdf is now 62% smaller: 4.2 MB to 1.6 MB."

## Rules
- Everything runs in the browser; nothing is uploaded.
- Photos and scans are where the size is, so they're made smaller:
  - Extreme: at most 72 dpi for a full page, JPEG quality 0.5.
  - Recommended: at most 144 dpi, quality 0.7.
  - Less: at most 220 dpi, quality 0.85.
  - "At most N dpi" means the longer side is at most the document's longest page side, in inches, times N. Smaller images are not enlarged.
- An image is only replaced when the new one is smaller. Small images (under 8 KB) are left alone.
- Images handled: 8 bits per channel, RGB or grey (including ICC-based ones), stored as JPEG or Flate (with or without PNG predictors). Left as they are: CMYK, indexed colours, masks, 1-bit scans (JBIG2, CCITT), and images with a Decode array or colour-key Mask.
- Transparency (SMask) is kept as it is.
- Streams stored without compression are Flate-compressed, when that makes them smaller.
- Objects nothing points to (left over from earlier edits) are dropped, and the file is saved with object streams.
- Text, links, bookmarks and forms are not changed.
- If the result isn't smaller, the original is given back unchanged and the summary says the PDF is already well compressed.
- Password-protected and damaged files get the same errors as the other tools.

## Technical
- `src/tools/compress-pdf/compress.ts` holds the work with pdf-lib and fflate; the picture encoding is passed in, so unit tests run in Node with a stand-in and the worker uses `OffscreenCanvas` + `createImageBitmap`. Browsers without `OffscreenCanvas` still get the lossless savings.
- Runs in a worker, like Merge PDF, with progress per image.

## Content
- Title: "Compress PDF Online Free, No Upload | AnyTools.fyi". Meta description, guide (5 steps, limits, tips, 6 FAQs), diagram and share image.
- New registry entry, third in the list (after Merge and Split), with an icon, search aliases and related tools.
- Launch checklist from [[merge-pdf-is-the-template]].

## Tests
- Unit: level settings, target sizes, PNG predictor decoding, which images are picked, replacing images only when smaller, compressing raw streams, dropping orphans, names, the result still opening with the same pages.
- Browser: defaults, a PDF with a big photo gets smaller at each level (Extreme smallest), a text-only PDF comes back unchanged with the "already" message, several PDFs in a ZIP, a password-protected file, axe in light and dark, 320, 375, 768 and 1366 px, and Safari (WebKit).
