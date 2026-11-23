import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { buildCoverPdf } from "../server/pdf/cover.ts";
import { inspectPdf } from "../server/pdf/inspect.ts";
import { buildInteriorPdf } from "../server/pdf/interior.ts";
import { Canvas } from "../server/imaging/raster.ts";
import { medianStrokePx, prepareLineArt } from "../server/imaging/lineart.ts";
import { planInterior } from "../shared/layout.ts";
import { CUSTOM_TRIM, MAX_RECOMMENDED_DPI, TRIM_SIZES, coverLayout, customTrimId, findTrim, getTrim, interiorPageSize, pageLimits } from "../shared/kdp.ts";
import { bookSettingsSchema, coverConfigSchema, defaultSettings } from "../shared/settings.ts";
import { settings } from "./helpers.ts";

/** Expected values come from KDP's published tables (kdp.amazon.com help G201857950 / GVBQ3CMEQW3W2VL6). */
describe("KDP trim sizes", () => {
  test("all 16 standard US paperback trims are supported", () => {
    const ids = ["5x8", "5.06x7.81", "5.25x8", "5.5x8.5", "6x9", "6.14x9.21", "6.69x9.61", "7x10", "7.44x9.69", "7.5x9.25", "8x10", "8.25x6", "8.25x8.25", "8.5x8.5", "8.5x11", "8.27x11.69"];
    expect(TRIM_SIZES.map((t) => t.id).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(bookSettingsSchema.safeParse({ ...settings(), trimSize: id }).success, id).toBe(true);
  });

  test("bleed page sizes match KDP's published table", () => {
    const expected: Record<string, [number, number]> = { "5x8": [5.125, 8.25], "6x9": [6.125, 9.25], "6.14x9.21": [6.265, 9.46], "7x10": [7.125, 10.25], "7.5x9.25": [7.625, 9.5], "8x10": [8.125, 10.25], "8.25x8.25": [8.375, 8.5], "8.5x8.5": [8.625, 8.75], "8.5x11": [8.625, 11.25], "8.27x11.69": [8.395, 11.94] };
    for (const [id, [w, h]] of Object.entries(expected)) {
      const size = interiorPageSize(getTrim(id), true);
      expect(size.width, id).toBeCloseTo(w, 2);
      expect(size.height, id).toBeCloseTo(h, 2);
    }
  });

  test("custom trims: width 4–8.5 in, height 6–11.69 in", () => {
    expect(findTrim(customTrimId(6.5, 9.5))).toMatchObject({ width: 6.5, height: 9.5, custom: true });
    for (const bad of ["custom:3.9x9", "custom:8.6x9", "custom:6x5.9", "custom:6x11.7", "custom:abc", "9x9", "custom:6x9; DROP TABLE"]) expect(findTrim(bad), bad).toBeUndefined();
    expect(CUSTOM_TRIM.maxHeight).toBe(11.69);
    expect(bookSettingsSchema.safeParse({ ...settings(), trimSize: "custom:9x9" }).success).toBe(false);
    expect(bookSettingsSchema.safeParse({ ...settings(), trimSize: "custom:6.25x9.5" }).success).toBe(true);
  });
});

describe("KDP page-count limits per trim and paper", () => {
  test("regular trims", () => {
    expect(pageLimits("6x9", "white")).toMatchObject({ min: 24, max: 828, available: true });
    expect(pageLimits("6x9", "cream").max).toBe(776);
    expect(pageLimits("6x9", "standard_color")).toMatchObject({ min: 72, max: 600 });
    expect(pageLimits("6x9", "premium_color").max).toBe(828);
  });
  test("8.5 × 11 and 8.5 × 8.5 are capped lower", () => {
    expect(pageLimits("8.5x11", "white").max).toBe(590);
    expect(pageLimits("8.5x11", "cream").max).toBe(550);
    expect(pageLimits("8.5x8.5", "premium_color").max).toBe(590);
  });
  test("8.25 trims and A4", () => {
    expect(pageLimits("8.25x8.25", "white").max).toBe(800);
    expect(pageLimits("8.25x6", "cream").max).toBe(750);
    expect(pageLimits("8.27x11.69", "white").max).toBe(780);
    expect(pageLimits("8.27x11.69", "standard_color").available).toBe(false);
  });
  test("custom trims use the stricter limits and are marked approximate", () => {
    expect(pageLimits(customTrimId(7, 10), "white")).toMatchObject({ max: 590, approximate: true });
    expect(pageLimits(customTrimId(5, 8), "white")).toMatchObject({ max: 828, approximate: true });
  });
});

describe("KDP file rules", () => {
  const cfg = settings({ illustrationCount: 12, trimSize: "6x9" });
  const art = new Canvas(1200, 1600, 1, 255);
  art.ellipse(600, 800, 400, 500, 14);
  const raster = art.toRaster();

  async function interior() {
    const content = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, storyText: "", activity: "" }));
    const plan = planInterior(cfg, content);
    return buildInteriorPdf({ settings: cfg, plan, title: "T", subtitle: "", author: "A", copyrightText: "c", content: new Map(content.map((c) => [c.id, { storyText: "", activity: "", sceneTitle: "s" }])), loadImage: async () => raster });
  }

  test("PDFs have no metadata, annotations or encryption, and every font is embedded", async () => {
    const i = await inspectPdf((await interior()).bytes);
    expect(i.hasMetadata).toBe(false);
    expect(i.annotationPages).toEqual([]);
    expect(i.encrypted).toBe(false);
    expect(i.fonts.length).toBeGreaterThan(0);
    expect(i.fonts.every((f) => f.embedded)).toBe(true);
    const doc = await PDFDocument.load((await interior()).bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getProducer()).toBeUndefined();
    expect(i.annotationPages).toEqual([]);
  });

  test("interior pages are single pages at the trim size and share one orientation", async () => {
    const i = await inspectPdf((await interior()).bytes);
    expect(new Set(i.pageSizes.map((s) => `${s.width}x${s.height}`)).size).toBe(1);
    expect(i.pageSizes[0]).toEqual({ width: 6, height: 9 });
  });

  test("an unreadable or encrypted-looking file is reported, not thrown", async () => {
    const r = await inspectPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    expect(r.readable).toBe(false);
  });

  test("spine text needs 80+ pages AND a spine wide enough for 7 pt text", () => {
    const trim = getTrim("6x9");
    expect(coverLayout(trim, 60, "white")).toMatchObject({ spineTextAllowed: false, spineTextBlockedReason: "pages" });
    expect(coverLayout(trim, 80, "white")).toMatchObject({ spineTextAllowed: false, spineTextBlockedReason: "narrow" });
    expect(coverLayout(trim, 90, "white").spineTextAllowed).toBe(false); // 0.0003 in short of 7 pt
    expect(coverLayout(trim, 91, "white")).toMatchObject({ spineTextAllowed: true, spineTextBlockedReason: null });
    expect(coverLayout(trim, 82, "cream").spineTextAllowed).toBe(true);
  });

  test("spine text is drawn at 7 pt or larger", async () => {
    const trim = getTrim("6x9");
    const layout = coverLayout(trim, 100, "white");
    const out = await buildCoverPdf({ layout, config: coverConfigSchema.parse({ title: "Spine Title", author: "Me" }), title: "Spine Title", subtitle: "", author: "Me", backText: "", art: null, thumbnails: [] });
    expect(out.report.spineTextDrawn).toBe(true);
    const el = out.report.elements.find((e) => e.kind === "spine_text")!;
    expect(el.rect.width * 72 / 0.72).toBeGreaterThanOrEqual(7 - 0.01);
  });

  test("barcode box meets KDP's minimum size and 0.25 in clearance", () => {
    const L = coverLayout(getTrim("8.5x11"), 100, "white");
    expect(L.barcode.width).toBeGreaterThanOrEqual(1.4);
    expect(L.barcode.height).toBeGreaterThanOrEqual(0.8);
    expect(L.back.x + L.back.width - (L.barcode.x + L.barcode.width)).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(L.barcode.y - L.back.y).toBeGreaterThanOrEqual(0.25 - 1e-9);
  });
});

describe("image rules", () => {
  test("images above 600 DPI are reduced; below 300 DPI they are upscaled to 300", () => {
    const big = new Canvas(6000, 8000, 1, 255);
    big.ellipse(3000, 4000, 2000, 3000, 60);
    const high = prepareLineArt(big.toRaster(), { boxWidthIn: 7.5, boxHeightIn: 10, targetDpi: 300, threshold: true });
    expect(high.raster.width / 7.5).toBeLessThanOrEqual(MAX_RECOMMENDED_DPI + 2);
    expect(high.raster.width / 7.5).toBeGreaterThanOrEqual(300);
    const small = new Canvas(900, 1200, 1, 255);
    small.ellipse(450, 600, 300, 450, 10);
    const low = prepareLineArt(small.toRaster(), { boxWidthIn: 7.5, boxHeightIn: 10, targetDpi: 300, threshold: true });
    expect(low.raster.width / 7.5).toBeGreaterThanOrEqual(300);
  });

  test("stroke-width measurement finds thin versus bold lines", () => {
    const thin = new Canvas(1000, 1000, 1, 255);
    thin.ellipse(500, 500, 300, 300, 1.2);
    const bold = new Canvas(1000, 1000, 1, 255);
    bold.ellipse(500, 500, 300, 300, 14);
    expect(medianStrokePx(thin.toRaster())).toBeLessThanOrEqual(2);
    expect(medianStrokePx(bold.toRaster())).toBeGreaterThanOrEqual(12);
  });

  test("default settings are valid", () => expect(() => defaultSettings()).not.toThrow());
});
