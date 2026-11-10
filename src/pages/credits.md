---
layout: ../layouts/InfoLayout.astro
title: "Credits"
description: "The open source libraries AnyTools is built with, such as pdf-lib and PDF.js, and the licence for each one."
updated: "2026-11-09"
---

AnyTools is built with open source software. We list each library here with its license, and we add to this list as each tool is built.

- **Astro**, MIT License: builds the site's pages.
- **pdf-lib** 1.17.1, MIT License, by Andrew Dillon: reads, builds and changes PDF files in every PDF tool.
- **PDF.js** 6.5, Apache License 2.0, by Mozilla: draws page previews in every PDF tool.
- **fflate** 0.8.3, MIT License, by Arjun Barrett: packs several new files into one ZIP in Split PDF, Rotate PDF and JPG to PDF.
- **heic-to** 1.6.7, by Hopper Gee, with **libheif** by Dirk Farin and struktur AG, GNU Lesser General Public License 3.0: opens iPhone HEIC photos in JPG to PDF, in browsers that can't open them. It loads as its own file, only when a HEIC photo is added. Source code: [heic-to](https://github.com/hoppergee/heic-to) and [libheif](https://github.com/strukturag/libheif); license: [LGPL 3.0](https://www.gnu.org/licenses/lgpl-3.0.html).
- **qpdf** 12.2, Apache License 2.0, by Jay Berkenbilt and contributors, built for browsers as **qpdf-wasm** 0.3.0, ISC License, by neslinesli93: adds and removes passwords in Protect PDF and Unlock PDF. It loads as its own file, only when one of those tools runs. Source code: [qpdf](https://github.com/qpdf/qpdf) and [qpdf-wasm](https://github.com/neslinesli93/qpdf-wasm).
- **Plus Jakarta Sans**, SIL Open Font License 1.1, by Tokotype: the lettering in the AnyTools logo.
- **Dancing Script**, **Great Vibes** and **Caveat** by their project authors, and **Galada** by Pablo Impallari and Black Foundry, SIL Open Font License 1.1; **Satisfy** by Font Diner, Apache License 2.0: the handwriting fonts for typed signatures and initials in Sign PDF. They load only on that page.
- **Noto Sans Bengali** and **Noto Serif Bengali**, SIL Open Font License 1.1, by Google: draw Bangla text and digits in Add page numbers and Add watermark. They load only when Bangla is used.
