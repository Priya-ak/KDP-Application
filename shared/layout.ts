import { effectiveMargins, getTrim, interiorPageSize, liveArea, round4, type Margins, type Rect, type Size } from "./kdp.ts";
import type { BookSettings } from "./settings.ts";

/**
 * Deterministic interior layout. Given settings and the ordered content pages
 * it decides every physical page of the book (front matter, content, blank
 * backs, padding) and the boxes content is placed in. The PDF builder, the
 * validator and the image-preparation step all use this one function.
 */

export type LayoutKind = "title" | "copyright" | "belongs_to" | "dedication" | "color_test" | "content" | "blank";

export interface LayoutSource {
  id: string;
  storyText: string;
  activity: string;
}

export interface LayoutPage {
  number: number;
  kind: LayoutKind;
  pageId?: string;
  /** Blank pages that are part of the design (backs of coloring pages, padding). */
  intentionalBlank: boolean;
  live: Rect;
  imageBox?: Rect;
  textBox?: Rect;
  captionBox?: Rect;
}

export interface InteriorPlan {
  trim: Size;
  bleed: boolean;
  pageSize: Size;
  margins: Margins;
  pageCount: number;
  contentCount: number;
  pages: LayoutPage[];
}

const CAPTION_HEIGHT = 0.45;

export function contentBoxes(settings: BookSettings, live: Rect, src: { storyText: string; activity: string }): Pick<LayoutPage, "imageBox" | "textBox" | "captionBox"> {
  const caption = src.activity.trim() ? CAPTION_HEIGHT : 0;
  const captionBox = caption ? { x: live.x, y: live.y, width: live.width, height: caption } : undefined;
  const area: Rect = { x: live.x, y: live.y + caption, width: live.width, height: round4(live.height - caption) };
  if (settings.mode === "coloring" || !src.storyText.trim()) {
    return { imageBox: area, captionBox };
  }
  const textShare = settings.mode === "story" ? 0.5 : 0.22;
  const textHeight = round4(area.height * textShare);
  const gap = 0.15;
  return {
    textBox: { x: area.x, y: area.y, width: area.width, height: textHeight },
    imageBox: { x: area.x, y: round4(area.y + textHeight + gap), width: area.width, height: round4(area.height - textHeight - gap) },
    captionBox,
  };
}

/** Order of front-matter pages enabled in settings. */
function frontMatter(settings: BookSettings): LayoutKind[] {
  const fm: LayoutKind[] = [];
  if (settings.frontMatter.titlePage) fm.push("title");
  if (settings.frontMatter.copyrightPage) fm.push("copyright");
  if (settings.frontMatter.belongsTo) fm.push("belongs_to");
  if (settings.frontMatter.dedication.trim()) fm.push("dedication");
  if (settings.frontMatter.colorTestPage) fm.push("color_test");
  return fm;
}

export function planInterior(settings: BookSettings, content: LayoutSource[]): InteriorPlan {
  const trim = getTrim(settings.trimSize);
  // 1. Sequence of page kinds.
  const seq: Array<{ kind: LayoutKind; src?: LayoutSource; intentional: boolean }> = [];
  for (const kind of frontMatter(settings)) {
    seq.push({ kind, intentional: false });
    // Belongs-to and color-test pages are colored on, so give them a blank back too when printing single-sided.
    if (settings.blankBacks && (kind === "belongs_to" || kind === "color_test")) seq.push({ kind: "blank", intentional: true });
  }
  if (settings.blankBacks && seq.length % 2 === 1) seq.push({ kind: "blank", intentional: true }); // first coloring page on a right-hand page
  for (const src of content) {
    seq.push({ kind: "content", src, intentional: false });
    if (settings.blankBacks && settings.mode !== "story") seq.push({ kind: "blank", intentional: true });
  }
  if (seq.length % 2 === 1) seq.push({ kind: "blank", intentional: true }); // even page count
  const pageCount = seq.length;
  // 2. Margins depend on the final page count (gutter grows with thickness).
  const margins = effectiveMargins(settings.margins, pageCount, settings.bleed);
  const pages = seq.map((s, i): LayoutPage => {
    const number = i + 1;
    const live = liveArea(trim, settings.bleed, number, margins);
    const page: LayoutPage = { number, kind: s.kind, intentionalBlank: s.intentional, live };
    if (s.kind === "content" && s.src) Object.assign(page, { pageId: s.src.id }, contentBoxes(settings, live, s.src));
    return page;
  });
  return { trim, bleed: settings.bleed, pageSize: interiorPageSize(trim, settings.bleed), margins, pageCount, contentCount: content.length, pages };
}

/** Image box size (inches) a content page will get — used to prepare art at the right DPI before export. */
export function expectedImageBox(settings: BookSettings, contentCount: number, src: { storyText: string; activity: string }): Rect {
  const placeholders = Array.from({ length: contentCount }, (_, i) => ({ id: String(i), storyText: src.storyText, activity: src.activity }));
  const plan = planInterior(settings, placeholders.length ? placeholders : [{ id: "0", ...src }]);
  return plan.pages.find((p) => p.kind === "content")!.imageBox!;
}
