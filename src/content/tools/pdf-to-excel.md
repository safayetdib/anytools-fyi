---
updated: "2026-11-11"
howToTitle: "How to convert a PDF to Excel"
steps:
  - icon: select
    title: "Select the PDFs"
    text: "Choose one PDF or several, such as bank statements or invoices, or drop them onto the page."
  - icon: gear
    title: "Choose the sheets"
    text: "Keep one sheet for each page, or put all pages on one sheet, then select Convert to Excel."
  - icon: download
    title: "Download"
    text: "Save the .xlsx file, or all of them in one ZIP. Your PDFs aren't changed."
  - icon: check
    title: "Check the columns"
    text: "Open it in Excel, Google Sheets, LibreOffice or Numbers, and sort, filter or add up the figures."
limits:
  - icon: file
    value: "PDF"
    label: "File type"
    note: "Several files at once; each becomes its own .xlsx file."
  - icon: size
    value: "100 MB"
    label: "File size"
    note: "For each file, up to 500 pages."
  - icon: page
    value: "Rows, columns"
    label: "What comes out"
    note: "Every line of text as a row, with figures as real numbers. Pictures and colours are left out."
  - icon: check
    value: "Typed text"
    label: "Scanned PDFs"
    note: "Scans are pictures. Run OCR PDF on them first, then convert."
  - icon: lock
    value: "Unlock first"
    label: "Password-protected PDFs"
    note: "Remove the password with Unlock PDF, then convert. Many bank statements need this."
    tone: warn
  - icon: browser
    value: "Any"
    label: "Modern browser"
    note: "Chrome, Edge, Firefox and Safari, on phones and computers."
diagramTitle: "How converting to Excel works"
tipsTitle: "Tips for converting a PDF to Excel"
tips:
  - icon: lock
    title: "Locked bank statements"
    text: "Banks often lock statements with a password, like your account or card number. Remove it with Unlock PDF first."
  - icon: check
    title: "Scans need OCR first"
    text: "A scanned page is one big picture. Run it through OCR PDF first, then convert the searchable copy."
  - icon: arrange
    title: "One sheet or many"
    text: "A statement that runs over several pages is easiest on one sheet. Separate reports are easier one page to a sheet."
  - icon: page
    title: "Numbers you can add up"
    text: "Figures such as 1,250.00, (75) and 15% come out as numbers. Account and phone numbers with leading zeros stay as text, as written."
faq:
  - question: "Does this upload my PDF?"
    answer: "No. The tables are read and the workbook is built inside your browser, then saved straight to your device. That matters for bank statements: nothing is uploaded. You can check this in your browser's Network tab."
  - question: "How does it find the columns?"
    answer: "Each line of the PDF becomes a row, and text that lines up down the page, like a column of figures, goes in the same column of the sheet."
  - question: "Are the figures numbers or text?"
    answer: "Numbers. Amounts with commas, decimals, minus signs, brackets or a percent sign come out as numbers Excel can add up, with their commas and percent signs kept as formatting."
  - question: "Why is my workbook empty?"
    answer: "The PDF's pages are pictures, as in a scan or a photo, with no text inside. Run it through OCR PDF first, then convert the copy it gives you."
  - question: "Which programs open the file?"
    answer: "Microsoft Excel, Google Sheets, LibreOffice Calc, WPS Office and Apple Numbers all open .xlsx files."
  - question: "Does it work offline?"
    answer: "Yes, once your files are chosen. The page loads its PDF tools as soon as you start choosing files. After that, you can turn off your connection and still convert them."
---

Converting a PDF to Excel takes its tables out into rows and columns you can sort, filter and add up. Text that lines up down the page shares a column, and figures come out as real numbers, which suits bank statements, invoices and reports. Convert one PDF or many at once, and nothing ever leaves your device.
