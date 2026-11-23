import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Raster } from "../imaging/codec.ts";
import { effectiveDpi, fitContain, inchesToPoints, type Rect } from "../../shared/kdp.ts";
import { getAgeGroup } from "../../shared/options.ts";
import type { BookSettings } from "../../shared/settings.ts";
import type { InteriorPlan, LayoutPage } from "../../shared/layout.ts";
import { drawImageRef, embedFonts, embedRaster, fitText, safeText, type Fonts } from "./primitives.ts";

export interface InteriorContent {
  storyText: string;
  activity: string;
  sceneTitle: string;
}

export interface InteriorInput {
  settings: BookSettings;
  plan: InteriorPlan;
  title: string;
  subtitle: string;
  author: string;
  copyrightText: string;
  content: Map<string, InteriorContent>;
  /** Loads the print-ready raster of a content page (null when the page has no artwork). */
  loadImage: (pageId: string) => Promise<Raster | null>;
}

export interface PlacedImage {
  pixelWidth: number;
  pixelHeight: number;
  rect: Rect;
  box: Rect;
  dpi: number;
}

export interface InteriorPageReport {
  number: number;
  kind: LayoutPage["kind"];
  pageId?: string;
  intentionalBlank: boolean;
  image?: PlacedImage;
  missingImage?: boolean;
  textOverflow?: boolean;
  textSize?: number;
  /** Every element drawn on the page (inches), for margin checks. */
  elements: Rect[];
}

export interface InteriorReport {
  pageCount: number;
  pages: InteriorPageReport[];
}

const LABELS: Record<string, { belongs: string; test: string; testHint: string; name: string }> = {
  en: { belongs: "This Book Belongs To", test: "Color Test Page", testHint: "Try your markers, pencils and crayons here first.", name: "Name" },
  es: { belongs: "Este libro pertenece a", test: "Página de prueba de colores", testHint: "Prueba aquí tus rotuladores, lápices y ceras.", name: "Nombre" },
  fr: { belongs: "Ce livre appartient à", test: "Page de test des couleurs", testHint: "Essaie ici tes feutres, crayons et craies.", name: "Nom" },
  de: { belongs: "Dieses Buch gehört", test: "Farbtest-Seite", testHint: "Teste hier zuerst deine Stifte und Wachsmalstifte.", name: "Name" },
  it: { belongs: "Questo libro appartiene a", test: "Pagina di prova colori", testHint: "Prova qui pennarelli, matite e pastelli.", name: "Nome" },
  pt: { belongs: "Este livro pertence a", test: "Página de teste de cores", testHint: "Teste aqui suas canetas, lápis e giz de cera.", name: "Nome" },
  nl: { belongs: "Dit boek is van", test: "Kleurtestpagina", testHint: "Probeer hier eerst je stiften, potloden en krijtjes.", name: "Naam" },
};

function storyFontSize(settings: BookSettings): number {
  const id = getAgeGroup(settings.audience).id;
  if (id === "toddler" || id === "preschool" || id === "senior") return 22;
  if (id === "kids") return 18;
  if (id === "tween") return 15;
  return 13;
}

const pt = inchesToPoints;

/** Draws centered, wrapped text inside a box (inches). Returns the occupied rect and overflow flag. */
function drawTextBlock(page: PDFPage, font: PDFFont, text: string, box: Rect, size: number, minSize: number, align: "center" | "top" = "center"): { rect: Rect; overflow: boolean; size: number } {
  const clean = safeText(font, text);
  const fit = fitText(font, clean, pt(box.width), pt(box.height), size, minSize);
  const blockHeight = fit.lines.length * fit.lineHeight;
  const topY = align === "center" ? pt(box.y) + (pt(box.height) + blockHeight) / 2 : pt(box.y + box.height);
  let widest = 0;
  fit.lines.forEach((line, i) => {
    const w = font.widthOfTextAtSize(line, fit.size);
    widest = Math.max(widest, w);
    const x = pt(box.x) + (pt(box.width) - w) / 2;
    const y = topY - fit.lineHeight * (i + 1) + (fit.lineHeight - fit.size) / 2 + fit.size * 0.2;
    page.drawText(line, { x, y, size: fit.size, font, color: rgb(0, 0, 0) });
  });
  const rect: Rect = { x: box.x + (box.width - widest / 72) / 2, y: topY / 72 - blockHeight / 72, width: widest / 72, height: blockHeight / 72 };
  return { rect, overflow: fit.overflow, size: fit.size };
}

export async function buildInteriorPdf(input: InteriorInput): Promise<{ bytes: Uint8Array; report: InteriorReport }> {
  const { settings, plan } = input;
  // KDP asks for files without metadata, so no document info is written.
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fonts: Fonts = await embedFonts(doc);
  const labels = LABELS[settings.language] ?? LABELS.en!;
  const reports: InteriorPageReport[] = [];

  for (const lp of plan.pages) {
    const page = doc.addPage([pt(plan.pageSize.width), pt(plan.pageSize.height)]);
    const report: InteriorPageReport = { number: lp.number, kind: lp.kind, pageId: lp.pageId, intentionalBlank: lp.intentionalBlank, elements: [] };
    const live = lp.live;
    switch (lp.kind) {
      case "title": {
        const titleBox: Rect = { x: live.x, y: live.y + live.height * 0.55, width: live.width, height: live.height * 0.3 };
        const t = drawTextBlock(page, fonts.display, input.title || "Untitled", titleBox, 40, 18);
        report.elements.push(t.rect);
        report.textOverflow = t.overflow;
        if (input.subtitle) report.elements.push(drawTextBlock(page, fonts.body, input.subtitle, { x: live.x, y: live.y + live.height * 0.4, width: live.width, height: live.height * 0.13 }, 16, 10).rect);
        if (input.author) report.elements.push(drawTextBlock(page, fonts.bodyBold, input.author, { x: live.x, y: live.y + live.height * 0.08, width: live.width, height: 0.6 }, 14, 9).rect);
        break;
      }
      case "copyright": {
        const r = drawTextBlock(page, fonts.body, input.copyrightText || `Copyright © ${new Date().getFullYear()} ${input.author}. All rights reserved.`, { x: live.x, y: live.y, width: live.width, height: live.height * 0.3 }, 9, 7);
        report.elements.push(r.rect);
        report.textOverflow = r.overflow;
        break;
      }
      case "belongs_to": {
        const frame: Rect = { x: live.x + 0.2, y: live.y + live.height * 0.3, width: live.width - 0.4, height: live.height * 0.4 };
        page.drawRectangle({ x: pt(frame.x), y: pt(frame.y), width: pt(frame.width), height: pt(frame.height), borderColor: rgb(0, 0, 0), borderWidth: 3 });
        report.elements.push(frame);
        drawTextBlock(page, fonts.display, labels.belongs, { x: frame.x + 0.3, y: frame.y + frame.height * 0.5, width: frame.width - 0.6, height: frame.height * 0.4 }, 30, 16);
        const lineY = frame.y + frame.height * 0.3;
        page.drawLine({ start: { x: pt(frame.x + 0.6), y: pt(lineY) }, end: { x: pt(frame.x + frame.width - 0.6), y: pt(lineY) }, thickness: 1.5, color: rgb(0, 0, 0) });
        break;
      }
      case "dedication": {
        const r = drawTextBlock(page, fonts.body, settings.frontMatter.dedication, { x: live.x + 0.4, y: live.y + live.height * 0.4, width: live.width - 0.8, height: live.height * 0.3 }, 16, 10);
        report.elements.push(r.rect);
        report.textOverflow = r.overflow;
        break;
      }
      case "color_test": {
        report.elements.push(drawTextBlock(page, fonts.display, labels.test, { x: live.x, y: live.y + live.height - 0.9, width: live.width, height: 0.8 }, 28, 16).rect);
        report.elements.push(drawTextBlock(page, fonts.body, labels.testHint, { x: live.x, y: live.y + live.height - 1.4, width: live.width, height: 0.45 }, 12, 9).rect);
        const cols = 4;
        const rows = 6;
        const gridTop = live.y + live.height - 1.6;
        const cellW = live.width / cols;
        const cellH = (gridTop - live.y) / rows;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const cell: Rect = { x: live.x + c * cellW + 0.08, y: gridTop - (r + 1) * cellH + 0.08, width: cellW - 0.16, height: cellH - 0.16 };
            page.drawRectangle({ x: pt(cell.x), y: pt(cell.y), width: pt(cell.width), height: pt(cell.height), borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
            report.elements.push(cell);
          }
        break;
      }
      case "content": {
        const src = input.content.get(lp.pageId!);
        if (lp.imageBox) {
          const raster = await input.loadImage(lp.pageId!);
          if (raster) {
            const rect = fitContain(raster.width, raster.height, lp.imageBox);
            drawImageRef(page, embedRaster(doc, raster), rect);
            report.image = { pixelWidth: raster.width, pixelHeight: raster.height, rect, box: lp.imageBox, dpi: effectiveDpi(raster.width, raster.height, rect.width, rect.height) };
            report.elements.push(rect);
          } else {
            report.missingImage = settings.mode !== "story";
          }
        }
        if (lp.textBox && src?.storyText) {
          const size = storyFontSize(settings);
          const r = drawTextBlock(page, fonts.body, src.storyText, lp.textBox, size, Math.max(10, size * 0.65));
          report.elements.push(r.rect);
          report.textOverflow = r.overflow;
          report.textSize = r.size;
        }
        if (lp.captionBox && src?.activity) report.elements.push(drawTextBlock(page, fonts.bodyBold, src.activity, lp.captionBox, 11, 8).rect);
        break;
      }
      case "blank":
        break;
    }
    reports.push(report);
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report: { pageCount: plan.pageCount, pages: reports } };
}
