import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { formatSize } from "../../lib/files";
import { loadPdfjs, previewPdfFile, previewPdfOutput } from "../../lib/pdf/preview";
import { ToolError, type ToolDefinition } from "../../lib/shell/types";
import { zipParts } from "../../lib/zip";
import { MAX_IMAGES, jpgName, readChoice } from "./convert";
import { PdfLocked, openPdf, pageImages, pageToJpeg, previewImage } from "./render";

const t = en.pdfToJpg;
const MB = 1024 * 1024;
// Twice the shown width, so thumbnails stay sharp on high-density screens.
const THUMBNAIL_WIDTH = 128;

interface Picture {
  name: string;
  blob: Blob;
  label: string;
}

function stopIfCancelled(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}

export const tool: ToolDefinition = {
  config: {
    mode: "files",
    accept: ".pdf,application/pdf",
    acceptLabel: t.acceptLabel,
    arrangeHint: t.arrangeHint,
    multiple: true,
    minFiles: 1,
    maxFileSize: 100 * MB,
    warnFileSize: 30 * MB,
  },
  warm() {
    void loadPdfjs();
  },
  previewFile: (file) => previewPdfFile(file, THUMBNAIL_WIDTH),
  // Results are JPGs, so their previews show the picture itself.
  previewOutput: (blob) => (blob.type.startsWith("image/") ? previewImage(blob) : previewPdfOutput(blob)),
  async run({ files }, options, { signal, onProgress }) {
    const choice = readChoice(options.choice ?? "");
    const lib = await loadPdfjs();
    const opened: { file: File; doc: Awaited<ReturnType<typeof openPdf>> }[] = [];
    try {
      for (const file of files) {
        try {
          opened.push({ file, doc: await openPdf(file) });
        } catch (error) {
          throw new ToolError(fill(error instanceof PdfLocked ? t.encrypted : t.unreadable, { name: file.name }));
        }
      }
      const total = opened.reduce((sum, { doc }) => sum + doc.doc.numPages, 0);
      if (choice.mode === "pages" && total > MAX_IMAGES) throw new ToolError(fill(t.tooMany, { max: MAX_IMAGES }));

      const pictures: Picture[] = [];
      let done = 0;
      for (const { file, doc } of opened) {
        const seen = new Set<string>();
        let number = 0;
        for (let pageNumber = 1; pageNumber <= doc.doc.numPages; pageNumber++) {
          stopIfCancelled(signal);
          const page = await doc.doc.getPage(pageNumber);
          try {
            if (choice.mode === "pages") {
              pictures.push({ name: jpgName(file.name, "page", pageNumber), blob: await pageToJpeg(page, choice.quality), label: fill(t.partPage, { page: pageNumber, name: file.name }) });
            } else {
              for (const blob of await pageImages(lib, page, seen, choice.quality)) {
                number++;
                pictures.push({ name: jpgName(file.name, "image", number), blob, label: fill(t.partImage, { number, name: file.name }) });
              }
              if (pictures.length > MAX_IMAGES) throw new ToolError(fill(t.tooMany, { max: MAX_IMAGES }));
            }
          } finally {
            page.cleanup();
          }
          onProgress(++done / (total + 1));
        }
      }

      if (!pictures.length) throw new ToolError(files.length === 1 ? fill(t.noImages, { name: files[0].name }) : t.noImagesMany);
      if (pictures.length === 1) {
        const [only] = pictures;
        return { files: [{ name: only.name, blob: only.blob }], summary: fill(t.summaryOne, { output: only.name, size: formatSize(only.blob.size) }) };
      }
      const entries = await Promise.all(pictures.map(async ({ name, blob }) => ({ name, bytes: new Uint8Array(await blob.arrayBuffer()) })));
      const zip = new Blob([zipParts(entries) as BlobPart], { type: "application/zip" });
      onProgress(1);
      const size = formatSize(zip.size);
      return {
        files: [{ name: choice.mode === "pages" ? t.zipPages : t.zipImages, blob: zip }],
        parts: pictures,
        summary: fill(choice.mode === "pages" ? t.summaryPages : t.summaryImages, { count: pictures.length, size }),
      };
    } finally {
      opened.forEach(({ doc }) => doc.close());
    }
  },
};
