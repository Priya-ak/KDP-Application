import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { POINTS_PER_INCH } from "../../shared/kdp.ts";

export interface PdfInspection {
  readable: boolean;
  error?: string;
  bytes: number;
  pageCount: number;
  /** MediaBox size of each page in inches. */
  pageSizes: Array<{ width: number; height: number }>;
  fonts: Array<{ name: string; embedded: boolean }>;
  /** A document Info dictionary (title, author, producer…) is present. KDP asks for none. */
  hasMetadata: boolean;
  /** Pages carrying annotations, links or form fields. */
  annotationPages: number[];
  encrypted: boolean;
}

/**
 * Re-opens a generated PDF and reads back what is actually in the file, so
 * validation checks the output rather than our intentions.
 */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    return { readable: false, error: (err as Error).message, bytes: bytes.length, pageCount: 0, pageSizes: [], fonts: [], hasMetadata: false, annotationPages: [], encrypted: /encrypt/i.test((err as Error).message) };
  }
  const pageSizes = doc.getPages().map((p) => {
    const { width, height } = p.getMediaBox();
    return { width: Math.round((width / POINTS_PER_INCH) * 10000) / 10000, height: Math.round((height / POINTS_PER_INCH) * 10000) / 10000 };
  });
  const fonts: PdfInspection["fonts"] = [];
  const lookupDict = (v: unknown): PDFDict | undefined => {
    const obj = v instanceof PDFRef ? doc.context.lookup(v) : v;
    return obj instanceof PDFDict ? obj : undefined;
  };
  const hasFontFile = (descriptor: PDFDict | undefined) => !!descriptor && ["FontFile", "FontFile2", "FontFile3"].some((k) => descriptor.has(PDFName.of(k)));
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (obj.get(PDFName.of("Type")) !== PDFName.of("Font")) continue;
    const subtype = obj.get(PDFName.of("Subtype"));
    if (subtype === PDFName.of("CIDFontType2") || subtype === PDFName.of("CIDFontType0")) continue; // checked through their Type0 parent
    const name = String(obj.get(PDFName.of("BaseFont")) ?? "unknown").replace(/^\//, "");
    let descriptor = lookupDict(obj.get(PDFName.of("FontDescriptor")));
    if (subtype === PDFName.of("Type0")) {
      const descendants = obj.get(PDFName.of("DescendantFonts"));
      const arr = descendants instanceof PDFRef ? doc.context.lookup(descendants) : descendants;
      const first = arr instanceof PDFArray ? lookupDict(arr.get(0)) : undefined;
      descriptor = lookupDict(first?.get(PDFName.of("FontDescriptor")));
    }
    fonts.push({ name, embedded: hasFontFile(descriptor) });
  }
  const info = doc.context.trailerInfo.Info;
  const infoDict = info ? lookupDict(info) : undefined;
  const hasMetadata = !!infoDict && infoDict.keys().length > 0;
  const annotationPages = doc.getPages().flatMap((p, i) => {
    const raw = p.node.get(PDFName.of("Annots"));
    const arr = raw instanceof PDFRef ? doc.context.lookup(raw) : raw;
    return arr instanceof PDFArray && arr.size() > 0 ? [i + 1] : []; // pdf-lib leaves empty arrays; only real annotations count
  });
  return { readable: true, bytes: bytes.length, pageCount: doc.getPageCount(), pageSizes, fonts, hasMetadata, annotationPages, encrypted: false };
}
