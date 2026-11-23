import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import fontkit from "@pdf-lib/fontkit";
import { clip, concatTransformationMatrix, drawObject, endPath, popGraphicsState, pushGraphicsState, rectangle, type PDFDocument, type PDFFont, type PDFPage, type PDFRef } from "pdf-lib";
import type { Raster } from "../imaging/codec.ts";
import { inchesToPoints, type Rect } from "../../shared/kdp.ts";

const require = createRequire(import.meta.url);

/** Open-licensed (OFL) TrueType fonts, embedded in full so KDP sees every glyph embedded. */
const FONT_FILES = {
  display: "@expo-google-fonts/fredoka/600SemiBold/Fredoka_600SemiBold.ttf",
  body: "@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf",
  bodyBold: "@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf",
} as const;

const fontCache = new Map<string, Uint8Array>();
function fontBytes(key: keyof typeof FONT_FILES): Uint8Array {
  let bytes = fontCache.get(key);
  if (!bytes) {
    bytes = readFileSync(require.resolve(FONT_FILES[key]));
    fontCache.set(key, bytes);
  }
  return bytes;
}

export interface Fonts {
  display: PDFFont;
  body: PDFFont;
  bodyBold: PDFFont;
}

export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  return {
    display: await doc.embedFont(fontBytes("display"), { subset: false }),
    body: await doc.embedFont(fontBytes("body"), { subset: false }),
    bodyBold: await doc.embedFont(fontBytes("bodyBold"), { subset: false }),
  };
}

/**
 * Embeds a raster as an image XObject without re-encoding to RGB: grayscale
 * art stays DeviceGray (correct for black-ink interiors), color art DeviceRGB.
 * Compression uses Node's native zlib.
 */
export function embedRaster(doc: PDFDocument, raster: Raster): PDFRef {
  const stream = doc.context.stream(deflateSync(raster.data, { level: 6 }), {
    Type: "XObject",
    Subtype: "Image",
    Width: raster.width,
    Height: raster.height,
    ColorSpace: raster.channels === 1 ? "DeviceGray" : "DeviceRGB",
    BitsPerComponent: 8,
    Filter: "FlateDecode",
  });
  return doc.context.register(stream);
}

/** Draws an embedded image into a rectangle given in inches, optionally clipped to another rectangle. */
export function drawImageRef(page: PDFPage, ref: PDFRef, rect: Rect, clipTo?: Rect) {
  const name = page.node.newXObject("Im", ref);
  const ops = [pushGraphicsState()];
  if (clipTo) ops.push(rectangle(inchesToPoints(clipTo.x), inchesToPoints(clipTo.y), inchesToPoints(clipTo.width), inchesToPoints(clipTo.height)), clip(), endPath());
  ops.push(concatTransformationMatrix(inchesToPoints(rect.width), 0, 0, inchesToPoints(rect.height), inchesToPoints(rect.x), inchesToPoints(rect.y)), drawObject(name), popGraphicsState());
  page.pushOperators(...ops);
}

export interface WrappedText {
  lines: string[];
  size: number;
  lineHeight: number;
  overflow: boolean;
}

/**
 * Word-wraps text to a width (points) and shrinks the font size down to
 * minSize until it fits the height. `overflow` is true when even the minimum
 * size does not fit; callers report that as a validation error.
 */
export function fitText(font: PDFFont, text: string, maxWidthPt: number, maxHeightPt: number, size: number, minSize: number, lineFactor = 1.3): WrappedText {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  for (let s = size; s >= minSize - 0.01; s -= 0.5) {
    const lines: string[] = [];
    for (const para of paragraphs) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, s) <= maxWidthPt || !line) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      if (line) lines.push(line);
    }
    const lineHeight = s * lineFactor;
    const tooWide = lines.some((l) => font.widthOfTextAtSize(l, s) > maxWidthPt + 0.5);
    if (lines.length * lineHeight <= maxHeightPt && !tooWide) return { lines, size: s, lineHeight, overflow: false };
    if (s - 0.5 < minSize - 0.01) return { lines, size: s, lineHeight, overflow: true };
  }
  return { lines: [text], size: minSize, lineHeight: minSize * lineFactor, overflow: true };
}

/** Replaces characters the embedded fonts cannot encode (keeps PDF generation from throwing). */
export function safeText(font: PDFFont, text: string): string {
  const chars = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\n" || chars.has(cp)) out += ch;
    else if (/[‘’]/.test(ch)) out += "'";
    else if (/[“”]/.test(ch)) out += '"';
    else if (/[–—]/.test(ch)) out += "-";
    else out += "?";
  }
  return out;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
