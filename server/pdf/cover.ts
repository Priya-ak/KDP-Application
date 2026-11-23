import { degrees, PDFDocument, rgb } from "pdf-lib";
import type { Raster } from "../imaging/codec.ts";
import { CAP_HEIGHT_FACTOR, MIN_FONT_PT, inchesToPoints, type CoverLayout, type Rect } from "../../shared/kdp.ts";
import type { CoverConfig } from "../../shared/settings.ts";
import { drawImageRef, embedFonts, embedRaster, fitText, hexToRgb01, safeText } from "./primitives.ts";

export interface CoverElement {
  zone: "front" | "back" | "spine";
  kind: "title" | "subtitle" | "author" | "back_text" | "back_title" | "thumbnail" | "spine_text" | "barcode_box";
  rect: Rect;
  overflow?: boolean;
}

export interface CoverReport {
  width: number;
  height: number;
  spineWidth: number;
  spineTextDrawn: boolean;
  art?: { pixelWidth: number; pixelHeight: number; drawnWidth: number; drawnHeight: number; dpi: number };
  elements: CoverElement[];
}

export interface CoverInput {
  layout: CoverLayout;
  config: CoverConfig;
  title: string;
  subtitle: string;
  author: string;
  backText: string;
  art: Raster | null;
  thumbnails: Raster[];
}

const pt = inchesToPoints;

/** Scale-to-fill: the art covers the whole target (cropped by clipping). */
function fillRect(imgW: number, imgH: number, target: Rect): Rect {
  const scale = Math.max(target.width / imgW, target.height / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: target.x + (target.width - w) / 2, y: target.y + (target.height - h) / 2, width: w, height: h };
}

/**
 * Builds the full paperback cover wrap (back, spine, front) at the exact size
 * from coverLayout(). Artwork is a raster; every piece of text is typeset with
 * embedded vector fonts (never baked into the artwork).
 */
export async function buildCoverPdf(input: CoverInput): Promise<{ bytes: Uint8Array; report: CoverReport }> {
  const { layout: L, config } = input;
  // KDP asks for files without metadata, so no document info is written.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts = await embedFonts(doc);
  const page = doc.addPage([pt(L.width), pt(L.height)]);
  const [br, bg, bb] = hexToRgb01(config.backgroundColor);
  const [tr, tg, tb] = hexToRgb01(config.titleColor);
  const [ar, ag, ab] = hexToRgb01(config.accentColor);
  const elements: CoverElement[] = [];
  const report: CoverReport = { width: L.width, height: L.height, spineWidth: L.spineWidth, spineTextDrawn: false, elements };

  // Background across the whole wrap, including bleed.
  page.drawRectangle({ x: 0, y: 0, width: pt(L.width), height: pt(L.height), color: rgb(br, bg, bb) });
  // Spine accent band.
  page.drawRectangle({ x: pt(L.spine.x), y: 0, width: pt(L.spine.width), height: pt(L.height), color: rgb(ar, ag, ab) });

  // Front artwork fills the front panel and its bleed.
  const frontArea: Rect = { x: L.front.x, y: 0, width: L.width - L.front.x, height: L.height };
  if (input.art) {
    const rect = fillRect(input.art.width, input.art.height, frontArea);
    drawImageRef(page, embedRaster(doc, input.art), rect, frontArea);
    report.art = { pixelWidth: input.art.width, pixelHeight: input.art.height, drawnWidth: rect.width, drawnHeight: rect.height, dpi: Math.floor(input.art.width / rect.width) };
  }

  // Front title panel.
  const safe = L.frontSafe;
  const panelH = safe.height * 0.3 * config.titleScale;
  const panel: Rect = config.titlePosition === "top" ? { x: safe.x, y: safe.y + safe.height - panelH, width: safe.width, height: panelH } : { x: safe.x, y: safe.y + 0.55, width: safe.width, height: panelH };
  page.drawRectangle({ x: pt(panel.x), y: pt(panel.y), width: pt(panel.width), height: pt(panel.height), color: rgb(1, 1, 1), opacity: 0.86, borderColor: rgb(tr, tg, tb), borderWidth: 2, borderOpacity: 0.9 });
  const titleText = safeText(fonts.display, input.title || "Untitled");
  const titleBox: Rect = { x: panel.x + 0.15, y: panel.y + panel.height * (input.subtitle ? 0.34 : 0.1), width: panel.width - 0.3, height: panel.height * (input.subtitle ? 0.6 : 0.8) };
  const tf = fitText(fonts.display, titleText, pt(titleBox.width), pt(titleBox.height), Math.round(L.trim.width * 6 * config.titleScale), 14, 1.15);
  const drawCentered = (lines: string[], font: typeof fonts.display, size: number, lineHeight: number, box: Rect, color: ReturnType<typeof rgb>) => {
    const blockH = lines.length * lineHeight;
    const top = pt(box.y) + (pt(box.height) + blockH) / 2;
    let widest = 0;
    lines.forEach((line, i) => {
      const w = font.widthOfTextAtSize(line, size);
      widest = Math.max(widest, w);
      page.drawText(line, { x: pt(box.x) + (pt(box.width) - w) / 2, y: top - lineHeight * (i + 1) + (lineHeight - size) / 2 + size * 0.22, size, font, color });
    });
    return { x: box.x + (box.width - widest / 72) / 2, y: top / 72 - blockH / 72, width: widest / 72, height: blockH / 72 };
  };
  elements.push({ zone: "front", kind: "title", rect: drawCentered(tf.lines, fonts.display, tf.size, tf.lineHeight, titleBox, rgb(tr, tg, tb)), overflow: tf.overflow });
  if (input.subtitle) {
    const subBox: Rect = { x: panel.x + 0.2, y: panel.y + panel.height * 0.06, width: panel.width - 0.4, height: panel.height * 0.26 };
    const sf = fitText(fonts.bodyBold, safeText(fonts.bodyBold, input.subtitle), pt(subBox.width), pt(subBox.height), Math.round(L.trim.width * 2.1), 8, 1.2);
    elements.push({ zone: "front", kind: "subtitle", rect: drawCentered(sf.lines, fonts.bodyBold, sf.size, sf.lineHeight, subBox, rgb(0.15, 0.15, 0.2)), overflow: sf.overflow });
  }
  if (input.author) {
    const authorBox: Rect = config.titlePosition === "top" ? { x: safe.x + 0.5, y: safe.y, width: safe.width - 1, height: 0.5 } : { x: safe.x + 0.5, y: safe.y + safe.height - 0.5, width: safe.width - 1, height: 0.5 };
    page.drawRectangle({ x: pt(authorBox.x), y: pt(authorBox.y), width: pt(authorBox.width), height: pt(authorBox.height), color: rgb(1, 1, 1), opacity: 0.86 });
    const af = fitText(fonts.bodyBold, safeText(fonts.bodyBold, input.author), pt(authorBox.width - 0.2), pt(authorBox.height), 16, 8, 1.1);
    elements.push({ zone: "front", kind: "author", rect: drawCentered(af.lines, fonts.bodyBold, af.size, af.lineHeight, authorBox, rgb(0.1, 0.1, 0.15)), overflow: af.overflow });
  }

  // Back cover: title, description, thumbnail grid, reserved barcode box.
  const back = L.backSafe;
  const backTitleBox: Rect = { x: back.x, y: back.y + back.height - 0.7, width: back.width, height: 0.6 };
  const btf = fitText(fonts.display, titleText, pt(backTitleBox.width), pt(backTitleBox.height), 22, 11, 1.1);
  elements.push({ zone: "back", kind: "back_title", rect: drawCentered(btf.lines, fonts.display, btf.size, btf.lineHeight, backTitleBox, rgb(tr, tg, tb)), overflow: btf.overflow });
  const barcodeTop = L.barcode.y + L.barcode.height;
  const thumbs = config.showThumbnails ? input.thumbnails.slice(0, 4) : [];
  const textTop = backTitleBox.y - 0.15;
  const textHeight = thumbs.length ? back.height * 0.3 : textTop - (barcodeTop + 0.2);
  const backTextBox: Rect = { x: back.x, y: textTop - textHeight, width: back.width, height: textHeight };
  if (input.backText.trim()) {
    const bf = fitText(fonts.body, safeText(fonts.body, input.backText), pt(backTextBox.width), pt(backTextBox.height), 12, 8, 1.35);
    const top = pt(backTextBox.y + backTextBox.height);
    let widest = 0;
    bf.lines.forEach((line, i) => {
      widest = Math.max(widest, fonts.body.widthOfTextAtSize(line, bf.size));
      page.drawText(line, { x: pt(backTextBox.x), y: top - bf.lineHeight * (i + 1) + bf.size * 0.3, size: bf.size, font: fonts.body, color: rgb(0.1, 0.1, 0.15) });
    });
    elements.push({ zone: "back", kind: "back_text", rect: { x: backTextBox.x, y: backTextBox.y + backTextBox.height - (bf.lines.length * bf.lineHeight) / 72, width: widest / 72, height: (bf.lines.length * bf.lineHeight) / 72 }, overflow: bf.overflow });
  }
  if (thumbs.length) {
    const gridTop = backTextBox.y - 0.2;
    const gridBottom = barcodeTop + 0.25;
    const gap = 0.15;
    const cellH = (gridTop - gridBottom - gap) / 2;
    const cellW = Math.min((back.width - gap) / 2, cellH * 0.78);
    const gridW = cellW * 2 + gap;
    const x0 = back.x + (back.width - gridW) / 2;
    thumbs.forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cell: Rect = { x: x0 + col * (cellW + gap), y: gridTop - (row + 1) * cellH - row * gap, width: cellW, height: cellH };
      page.drawRectangle({ x: pt(cell.x), y: pt(cell.y), width: pt(cell.width), height: pt(cell.height), color: rgb(1, 1, 1), borderColor: rgb(tr, tg, tb), borderWidth: 1.5 });
      const inner: Rect = { x: cell.x + 0.06, y: cell.y + 0.06, width: cell.width - 0.12, height: cell.height - 0.12 };
      const scale = Math.min(inner.width / t.width, inner.height / t.height);
      const r: Rect = { x: inner.x + (inner.width - t.width * scale) / 2, y: inner.y + (inner.height - t.height * scale) / 2, width: t.width * scale, height: t.height * scale };
      drawImageRef(page, embedRaster(doc, t), r);
      elements.push({ zone: "back", kind: "thumbnail", rect: cell });
    });
  }
  if (config.reserveBarcode) {
    page.drawRectangle({ x: pt(L.barcode.x), y: pt(L.barcode.y), width: pt(L.barcode.width), height: pt(L.barcode.height), color: rgb(1, 1, 1) });
    elements.push({ zone: "back", kind: "barcode_box", rect: L.barcode });
  }

  // Spine text, top-to-bottom, only when KDP allows it.
  if (config.spineText && L.spineTextAllowed && L.spineSafe) {
    const s = L.spineSafe;
    const label = safeText(fonts.display, [input.title, input.author].filter(Boolean).join("  •  "));
    // Capital height is about 0.72 of the font size, so the text fits a spine of width w at size w / 0.8.
    let size = Math.min(pt(s.width) / CAP_HEIGHT_FACTOR, 18);
    while (size > MIN_FONT_PT && fonts.display.widthOfTextAtSize(label, size) > pt(s.height)) size -= 0.5;
    if (size >= MIN_FONT_PT) {
      const textLen = fonts.display.widthOfTextAtSize(label, size);
      const cx = s.x + s.width / 2;
      const capHalf = (size * 0.36) / 72;
      const yTop = s.y + s.height / 2 + textLen / 72 / 2;
      page.drawText(label, { x: pt(cx - capHalf), y: pt(yTop), size, font: fonts.display, color: rgb(1, 1, 1), rotate: degrees(-90) });
      elements.push({ zone: "spine", kind: "spine_text", rect: { x: cx - capHalf, y: yTop - textLen / 72, width: (size * 0.72) / 72, height: textLen / 72 } });
      report.spineTextDrawn = true;
    }
  }

  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}
