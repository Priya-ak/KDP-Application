/**
 * Amazon KDP paperback print specifications and deterministic layout math.
 *
 * Every number here comes from KDP's public help pages (re-checked 2026-11):
 *  - Trim size, bleed, margins:  https://kdp.amazon.com/help/topic/GVBQ3CMEQW3W2VL6
 *  - Cover size, spine, barcode: https://kdp.amazon.com/help/topic/G201953020 and /G5HDYGP4BXLX4RUW
 *  - Page counts, custom trim:   https://kdp.amazon.com/help/topic/G201834180
 *  - Paperback submission rules: https://kdp.amazon.com/help/topic/G201857950
 *  - Image resolution:           https://kdp.amazon.com/help/topic/G202169030
 * Scope: US-store paperbacks. Hardcover, groundwood paper and non-US stores are not supported.
 * Values KDP does not state as text (e.g. the barcode box position) are flagged for manual review by the validator.
 *
 * All lengths are inches. Coordinates use PDF conventions: origin at the
 * bottom-left of the page, y grows upwards.
 */

export const POINTS_PER_INCH = 72;
/** Bleed added to the top, bottom and outside edge of interior pages, and every edge of the cover. */
export const BLEED = 0.125;
/** Minimum distance between cover text and the trim lines. */
export const COVER_TEXT_MIN_INSET = 0.125;
/** Safe inset we actually lay cover text out at (conservative, keeps clear of fold variance). */
export const COVER_SAFE_INSET = 0.25;
/** Spine text must stay this far from each spine edge (fold variance). */
export const SPINE_TEXT_INSET = 0.0625;
/**
 * KDP wording is inconsistent ("at least 79 pages" vs "more than 79"; Cover Creator needs 80),
 * so the stricter 80 is used.
 */
export const SPINE_TEXT_MIN_PAGES = 80;
/** KDP: all fonts at least 7 pt (interior and cover). */
export const MIN_FONT_PT = 7;
/** Capital height is roughly 0.72 of the font size; text of size s fits a width of s * 0.8 pt. */
export const CAP_HEIGHT_FACTOR = 0.8;
/** KDP: minimum line weight 0.75 pt (0.01"). */
export const MIN_LINE_PT = 0.75;
/** Barcode box from KDP's barcode page: suggested 2" × 1.2", minimum 1.4" × 0.8", ≥ 0.25" from the spine and trim. */
export const BARCODE = { width: 2.0, height: 1.2, minWidth: 1.4, minHeight: 0.8, insetFromSpine: 0.25, insetFromBottom: 0.25 } as const;
/** KDP: images at least 300 DPI; below 200 DPI is "low resolution"; recommended ceiling 600 DPI. */
export const TARGET_DPI = 300;
export const MIN_ACCEPTABLE_DPI = 200;
export const MAX_RECOMMENDED_DPI = 600;
/** KDP's maximum upload size for interior and cover files (cover: 40 MB or less recommended). */
export const MAX_PDF_BYTES = 650 * 1024 * 1024;
export const COVER_RECOMMENDED_BYTES = 40 * 1024 * 1024;

export type PaperType = "white" | "cream" | "standard_color" | "premium_color";

export interface PaperSpec {
  id: PaperType;
  label: string;
  ink: "black" | "standard_color" | "premium_color";
  /** Spine thickness contributed by each interior page, in inches. */
  spinePerPage: number;
  minPages: number;
}

export const PAPER_TYPES: Record<PaperType, PaperSpec> = {
  white: { id: "white", label: "Black ink, white paper", ink: "black", spinePerPage: 0.002252, minPages: 24 },
  cream: { id: "cream", label: "Black ink, cream paper", ink: "black", spinePerPage: 0.0025, minPages: 24 },
  standard_color: { id: "standard_color", label: "Standard color, white paper", ink: "standard_color", spinePerPage: 0.002252, minPages: 72 },
  premium_color: { id: "premium_color", label: "Premium color, white paper", ink: "premium_color", spinePerPage: 0.002347, minPages: 24 },
};

export interface TrimSize {
  id: string;
  label: string;
  width: number;
  height: number;
  custom?: boolean;
}

/** Maximum page counts by paper type; null = that paper is not offered at this trim. */
type Maxes = Record<PaperType, number | null>;
const GROUP_REGULAR: Maxes = { white: 828, cream: 776, standard_color: 600, premium_color: 828 };
const GROUP_SQUARE_825: Maxes = { white: 800, cream: 750, standard_color: 600, premium_color: 800 };
const GROUP_LETTER: Maxes = { white: 590, cream: 550, standard_color: 600, premium_color: 590 };
const GROUP_A4: Maxes = { white: 780, cream: 730, standard_color: null, premium_color: 590 };

interface TrimEntry extends TrimSize {
  max: Maxes;
}

/** Every standard US paperback trim size KDP lists (width × height, inches). */
const TRIM_TABLE: TrimEntry[] = [
  { id: "8.5x11", label: '8.5" × 11" (Letter)', width: 8.5, height: 11, max: GROUP_LETTER },
  { id: "8.27x11.69", label: '8.27" × 11.69" (A4)', width: 8.27, height: 11.69, max: GROUP_A4 },
  { id: "8.5x8.5", label: '8.5" × 8.5" (Square)', width: 8.5, height: 8.5, max: GROUP_LETTER },
  { id: "8.25x8.25", label: '8.25" × 8.25" (Square)', width: 8.25, height: 8.25, max: GROUP_SQUARE_825 },
  { id: "8.25x6", label: '8.25" × 6" (Landscape)', width: 8.25, height: 6, max: GROUP_SQUARE_825 },
  { id: "8x10", label: '8" × 10"', width: 8, height: 10, max: GROUP_REGULAR },
  { id: "7.5x9.25", label: '7.5" × 9.25"', width: 7.5, height: 9.25, max: GROUP_REGULAR },
  { id: "7.44x9.69", label: '7.44" × 9.69"', width: 7.44, height: 9.69, max: GROUP_REGULAR },
  { id: "7x10", label: '7" × 10"', width: 7, height: 10, max: GROUP_REGULAR },
  { id: "6.69x9.61", label: '6.69" × 9.61"', width: 6.69, height: 9.61, max: GROUP_REGULAR },
  { id: "6.14x9.21", label: '6.14" × 9.21"', width: 6.14, height: 9.21, max: GROUP_REGULAR },
  { id: "6x9", label: '6" × 9"', width: 6, height: 9, max: GROUP_REGULAR },
  { id: "5.5x8.5", label: '5.5" × 8.5"', width: 5.5, height: 8.5, max: GROUP_REGULAR },
  { id: "5.25x8", label: '5.25" × 8"', width: 5.25, height: 8, max: GROUP_REGULAR },
  { id: "5.06x7.81", label: '5.06" × 7.81"', width: 5.06, height: 7.81, max: GROUP_REGULAR },
  { id: "5x8", label: '5" × 8"', width: 5, height: 8, max: GROUP_REGULAR },
];

export const TRIM_SIZES: TrimSize[] = TRIM_TABLE.map(({ max: _max, ...t }) => t);

/** KDP custom trim limits: width 4"–8.5", height 6"–11.69". */
export const CUSTOM_TRIM = { minWidth: 4, maxWidth: 8.5, minHeight: 6, maxHeight: 11.69 } as const;
const CUSTOM_RE = /^custom:(\d+(?:\.\d{1,2})?)x(\d+(?:\.\d{1,2})?)$/;

export function customTrimId(width: number, height: number): string {
  return `custom:${Math.round(width * 100) / 100}x${Math.round(height * 100) / 100}`;
}

/** Returns the trim for a standard id or a valid `custom:WxH` id; undefined when unsupported. */
export function findTrim(id: string): TrimSize | undefined {
  const std = TRIM_TABLE.find((t) => t.id === id);
  if (std) return { id: std.id, label: std.label, width: std.width, height: std.height };
  const m = CUSTOM_RE.exec(id);
  if (!m) return undefined;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < CUSTOM_TRIM.minWidth || width > CUSTOM_TRIM.maxWidth || height < CUSTOM_TRIM.minHeight || height > CUSTOM_TRIM.maxHeight) return undefined;
  return { id, label: `${width}" × ${height}" (custom)`, width, height, custom: true };
}

export function isValidTrimId(id: string): boolean {
  return !!findTrim(id);
}

export function getTrim(id: string): TrimSize {
  const trim = findTrim(id);
  if (!trim) throw new Error(`Unsupported trim size: ${id}`);
  return trim;
}

/** KDP treats trims wider than 6.12" or taller than 9" as large (different print cost). */
export function isLargeTrim(trim: TrimSize): boolean {
  return trim.width > 6.12 || trim.height > 9;
}

export interface PageLimits {
  min: number;
  max: number;
  /** False when KDP doesn't offer this paper at this trim (e.g. standard color at A4). */
  available: boolean;
  /** True for custom trims, whose exact limits KDP doesn't publish; the stricter large-trim limits are used. */
  approximate: boolean;
}

/** Minimum and maximum interior page counts for a trim and paper (KDP US paperback tables). */
export function pageLimits(trimId: string, paper: PaperType): PageLimits {
  const std = TRIM_TABLE.find((t) => t.id === trimId);
  const trim = getTrim(trimId);
  const maxes = std ? std.max : isLargeTrim(trim) ? GROUP_LETTER : GROUP_REGULAR;
  const max = maxes[paper];
  return { min: PAPER_TYPES[paper].minPages, max: max ?? 0, available: max !== null, approximate: !std };
}

/** Minimum inside (gutter) margin for a given interior page count. */
export function requiredInsideMargin(pageCount: number): number {
  if (pageCount <= 150) return 0.375;
  if (pageCount <= 300) return 0.5;
  if (pageCount <= 500) return 0.625;
  if (pageCount <= 700) return 0.75;
  return 0.875;
}

/** Minimum top, bottom and outside margin. */
export function requiredOutsideMargin(bleed: boolean): number {
  return bleed ? 0.375 : 0.25;
}

export interface Margins {
  top: number;
  bottom: number;
  outside: number;
  inside: number;
}

/** Effective margins: the user's choice, raised to KDP's minimums where needed. */
export function effectiveMargins(requested: Margins, pageCount: number, bleed: boolean): Margins {
  const outsideMin = requiredOutsideMargin(bleed);
  return {
    top: Math.max(requested.top, outsideMin),
    bottom: Math.max(requested.bottom, outsideMin),
    outside: Math.max(requested.outside, outsideMin),
    inside: Math.max(requested.inside, requiredInsideMargin(pageCount)),
  };
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** PDF page size for the interior: trim, or trim + bleed on top, bottom and outside edge. */
export function interiorPageSize(trim: Size, bleed: boolean): Size {
  return bleed ? { width: round4(trim.width + BLEED), height: round4(trim.height + 2 * BLEED) } : { width: trim.width, height: trim.height };
}

/** Odd page numbers are right-hand (recto) pages; their gutter is on the left. */
export function isRecto(pageNumber: number): boolean {
  return pageNumber % 2 === 1;
}

/** Trim box of a page inside its PDF page (bleed pages extend past it on the outside edge). */
export function trimBox(trim: Size, bleed: boolean, pageNumber: number): Rect {
  if (!bleed) return { x: 0, y: 0, width: trim.width, height: trim.height };
  return { x: isRecto(pageNumber) ? 0 : BLEED, y: BLEED, width: trim.width, height: trim.height };
}

/** The area inside the margins where content may be placed. */
export function liveArea(trim: Size, bleed: boolean, pageNumber: number, margins: Margins): Rect {
  const box = trimBox(trim, bleed, pageNumber);
  const left = isRecto(pageNumber) ? margins.inside : margins.outside;
  const right = isRecto(pageNumber) ? margins.outside : margins.inside;
  return {
    x: round4(box.x + left),
    y: round4(box.y + margins.bottom),
    width: round4(box.width - left - right),
    height: round4(box.height - margins.top - margins.bottom),
  };
}

export function spineWidth(pageCount: number, paper: PaperType): number {
  return round4(pageCount * PAPER_TYPES[paper].spinePerPage);
}

export interface CoverLayout {
  pageCount: number;
  paper: PaperType;
  trim: Size;
  spineWidth: number;
  /** Full cover PDF size including bleed on every edge. */
  width: number;
  height: number;
  bleed: number;
  back: Rect;
  spine: Rect;
  front: Rect;
  backSafe: Rect;
  frontSafe: Rect;
  /** Area where spine text may sit (null when spine text isn't possible). */
  spineSafe: Rect | null;
  spineTextAllowed: boolean;
  /** Why there is no spine text: too few pages for KDP, or a spine too narrow for 7 pt text. */
  spineTextBlockedReason: "pages" | "narrow" | null;
  barcode: Rect;
}

/**
 * Full paperback cover wrap: bleed + back + spine + front + bleed. Recalculate
 * whenever the final interior page count changes.
 */
export function coverLayout(trim: Size, pageCount: number, paper: PaperType): CoverLayout {
  const spine = spineWidth(pageCount, paper);
  const width = round4(BLEED + trim.width + spine + trim.width + BLEED);
  const height = round4(trim.height + 2 * BLEED);
  const back: Rect = { x: BLEED, y: BLEED, width: trim.width, height: trim.height };
  const spineRect: Rect = { x: round4(BLEED + trim.width), y: BLEED, width: spine, height: trim.height };
  const front: Rect = { x: round4(BLEED + trim.width + spine), y: BLEED, width: trim.width, height: trim.height };
  const inset = (r: Rect, d: number): Rect => ({ x: round4(r.x + d), y: round4(r.y + d), width: round4(r.width - 2 * d), height: round4(r.height - 2 * d) });
  const safeWidthPt = (spine - 2 * SPINE_TEXT_INSET) * POINTS_PER_INCH;
  const legible = safeWidthPt >= MIN_FONT_PT * CAP_HEIGHT_FACTOR;
  const spineTextAllowed = pageCount >= SPINE_TEXT_MIN_PAGES && legible;
  const spineTextBlockedReason = pageCount < SPINE_TEXT_MIN_PAGES ? "pages" : legible ? null : "narrow";
  return {
    pageCount,
    paper,
    trim: { width: trim.width, height: trim.height },
    spineWidth: spine,
    width,
    height,
    bleed: BLEED,
    back,
    spine: spineRect,
    front,
    backSafe: inset(back, COVER_SAFE_INSET),
    frontSafe: inset(front, COVER_SAFE_INSET),
    spineSafe: spineTextAllowed
      ? { x: round4(spineRect.x + SPINE_TEXT_INSET), y: round4(spineRect.y + COVER_SAFE_INSET), width: round4(spine - 2 * SPINE_TEXT_INSET), height: round4(trim.height - 2 * COVER_SAFE_INSET) }
      : null,
    spineTextAllowed,
    spineTextBlockedReason,
    barcode: {
      x: round4(back.x + back.width - BARCODE.insetFromSpine - BARCODE.width),
      y: round4(back.y + BARCODE.insetFromBottom),
      width: BARCODE.width,
      height: BARCODE.height,
    },
  };
}

/** Effective print resolution of an image drawn into a box of the given size. */
export function effectiveDpi(pixelWidth: number, pixelHeight: number, drawnWidthIn: number, drawnHeightIn: number): number {
  if (drawnWidthIn <= 0 || drawnHeightIn <= 0) return 0;
  return Math.floor(Math.min(pixelWidth / drawnWidthIn, pixelHeight / drawnHeightIn));
}

/** Largest rectangle with the image's aspect ratio that fits (centered) in the box. */
export function fitContain(imageWidth: number, imageHeight: number, box: Rect): Rect {
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

export function rectContains(outer: Rect, inner: Rect, tolerance = 0.001): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function inchesToPoints(inches: number): number {
  return inches * POINTS_PER_INCH;
}
