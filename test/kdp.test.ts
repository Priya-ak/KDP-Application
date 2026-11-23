import { describe, expect, test } from "vitest";
import {
  BLEED,
  coverLayout,
  effectiveDpi,
  effectiveMargins,
  getTrim,
  interiorPageSize,
  liveArea,
  requiredInsideMargin,
  spineWidth,
  trimBox,
} from "../shared/kdp.ts";
import { planInterior } from "../shared/layout.ts";
import { defaultSettings } from "../shared/settings.ts";

describe("KDP cover math", () => {
  test("spine width uses the per-paper multiplier, never a fixed value", () => {
    expect(spineWidth(100, "white")).toBeCloseTo(0.2252, 4);
    expect(spineWidth(100, "cream")).toBeCloseTo(0.25, 4);
    expect(spineWidth(100, "premium_color")).toBeCloseTo(0.2347, 4);
    expect(spineWidth(200, "white")).toBeGreaterThan(spineWidth(100, "white"));
  });

  test("full cover = bleed + back + spine + front + bleed", () => {
    const L = coverLayout(getTrim("6x9"), 120, "white");
    expect(L.spineWidth).toBeCloseTo(0.2702, 4);
    expect(L.width).toBeCloseTo(0.125 + 6 + 0.2702 + 6 + 0.125, 4);
    expect(L.height).toBeCloseTo(9.25, 4);
    expect(L.spine.x).toBeCloseTo(BLEED + 6, 4);
    expect(L.front.x).toBeCloseTo(BLEED + 6 + L.spineWidth, 4);
    expect(L.front.x + L.front.width + BLEED).toBeCloseTo(L.width, 4);
  });

  test("changing the page count recalculates dimensions", () => {
    const a = coverLayout(getTrim("8.5x11"), 28, "white");
    const b = coverLayout(getTrim("8.5x11"), 80, "white");
    expect(b.width).toBeGreaterThan(a.width);
    expect(b.width - a.width).toBeCloseTo(52 * 0.002252, 4);
  });

  test("spine text needs 80+ pages and a legible spine", () => {
    expect(coverLayout(getTrim("6x9"), 79, "white").spineTextAllowed).toBe(false);
    expect(coverLayout(getTrim("6x9"), 80, "white").spineTextAllowed).toBe(false); // spine too narrow for 7 pt text
    expect(coverLayout(getTrim("6x9"), 100, "white").spineTextAllowed).toBe(true);
    expect(coverLayout(getTrim("6x9"), 100, "white").spineSafe).not.toBeNull();
  });

  test("barcode box sits inside the back cover, clear of the spine", () => {
    const L = coverLayout(getTrim("8.5x11"), 100, "white");
    expect(L.barcode.x + L.barcode.width).toBeLessThanOrEqual(L.back.x + L.back.width);
    expect(L.barcode.x).toBeGreaterThan(L.back.x);
  });
});

describe("KDP interior math", () => {
  test("bleed adds 0.125 to width and 0.25 to height", () => {
    expect(interiorPageSize({ width: 6, height: 9 }, true)).toEqual({ width: 6.125, height: 9.25 });
    expect(interiorPageSize({ width: 6, height: 9 }, false)).toEqual({ width: 6, height: 9 });
  });

  test("inside margin grows with page count", () => {
    expect(requiredInsideMargin(24)).toBe(0.375);
    expect(requiredInsideMargin(150)).toBe(0.375);
    expect(requiredInsideMargin(151)).toBe(0.5);
    expect(requiredInsideMargin(301)).toBe(0.625);
    expect(requiredInsideMargin(501)).toBe(0.75);
    expect(requiredInsideMargin(701)).toBe(0.875);
  });

  test("user margins are raised to KDP minimums", () => {
    const m = effectiveMargins({ top: 0.25, bottom: 0.25, outside: 0.25, inside: 0.25 }, 200, true);
    expect(m).toEqual({ top: 0.375, bottom: 0.375, outside: 0.375, inside: 0.5 });
  });

  test("gutter is on the left of odd (recto) pages and the right of even pages", () => {
    const trim = { width: 6, height: 9 };
    const margins = { top: 0.5, bottom: 0.5, outside: 0.4, inside: 0.6 };
    const odd = liveArea(trim, false, 1, margins);
    const even = liveArea(trim, false, 2, margins);
    expect(odd.x).toBeCloseTo(0.6);
    expect(even.x).toBeCloseTo(0.4);
    expect(odd.width).toBeCloseTo(5);
    // with bleed, even pages are shifted right by the bleed on their outside (left) edge
    expect(trimBox(trim, true, 2).x).toBe(BLEED);
    expect(trimBox(trim, true, 1).x).toBe(0);
  });

  test("effective DPI", () => {
    expect(effectiveDpi(2550, 3300, 8.5, 11)).toBe(300);
    expect(effectiveDpi(1000, 1000, 8, 8)).toBe(125);
  });
});

describe("interior layout planning", () => {
  const content = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, storyText: "", activity: "" }));

  test("single-sided coloring pages get blank backs and start on a right-hand page", () => {
    const plan = planInterior(defaultSettings({ illustrationCount: 6, frontMatter: { titlePage: true, copyrightPage: true, belongsTo: false, colorTestPage: false, dedication: "" } }), content(6));
    const firstContent = plan.pages.find((p) => p.kind === "content")!;
    expect(firstContent.number % 2).toBe(1);
    expect(plan.pageCount % 2).toBe(0);
    const contentPages = plan.pages.filter((p) => p.kind === "content");
    for (const p of contentPages) expect(plan.pages[p.number]!.kind).toBe("blank"); // the page after is its blank back (or end padding)
    expect(plan.contentCount).toBe(6);
  });

  test("without blank backs every content page is consecutive", () => {
    const plan = planInterior(defaultSettings({ illustrationCount: 4, blankBacks: false }), content(4));
    expect(plan.pages.filter((p) => p.kind === "blank").length).toBeLessThanOrEqual(1);
    expect(plan.pageCount % 2).toBe(0);
  });

  test("margins follow the final page count", () => {
    const small = planInterior(defaultSettings({ illustrationCount: 10 }), content(10));
    const big = planInterior(defaultSettings({ illustrationCount: 90, margins: { top: 0.5, bottom: 0.5, outside: 0.5, inside: 0.3 } }), content(90));
    expect(small.margins.inside).toBe(0.5);
    expect(big.pageCount).toBeGreaterThan(150);
    expect(big.margins.inside).toBe(0.5);
  });

  test("story mode reserves a text box above the image", () => {
    const plan = planInterior(defaultSettings({ mode: "story_coloring", illustrationCount: 2 }), [{ id: "a", storyText: "Once upon a time", activity: "" }, { id: "b", storyText: "The end", activity: "" }]);
    const p = plan.pages.find((x) => x.kind === "content")!;
    expect(p.textBox).toBeDefined();
    expect(p.imageBox!.y).toBeGreaterThan(p.textBox!.y);
  });
});
