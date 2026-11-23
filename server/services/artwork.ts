import type { AppContext } from "../context.ts";
import { decodeImage, encodePng, sniffImageMime } from "../imaging/codec.ts";
import { analyzeLineArt, medianStrokePx, prepareLineArt, type QualityReport } from "../imaging/lineart.ts";
import { expectedImageBox } from "../../shared/layout.ts";
import { MIN_LINE_PT, POINTS_PER_INCH, TARGET_DPI } from "../../shared/kdp.ts";
import type { PageStatus } from "../../shared/settings.ts";
import { saveAsset, type Asset } from "./assets.ts";
import type { PageRow, ProjectRow } from "./projects.ts";

export interface ProcessedArtwork {
  asset: Asset;
  original: Asset;
  quality: QualityReport;
  status: PageStatus;
}

/**
 * Turns raw artwork (generated or uploaded) into the page's print asset:
 * keeps the original, prepares a print-resolution grayscale version sized for
 * the page's image box, and runs the automated line-art checks on what will
 * actually be printed.
 */
export async function processPageArtwork(
  app: AppContext,
  project: ProjectRow,
  page: Pick<PageRow, "id" | "story_text" | "activity">,
  bytes: Uint8Array,
  source: { provider: string; isDemo: boolean; kind: "original" | "upload"; meta: Record<string, unknown> },
): Promise<ProcessedArtwork> {
  const raster = decodeImage(bytes);
  const contentCount = (await app.db.one<{ n: number }>("SELECT count(*)::int AS n FROM pages WHERE project_id = $1", [project.id]))?.n ?? 1;
  const box = expectedImageBox(project.settings, Math.max(1, contentCount), { storyText: page.story_text, activity: page.activity });
  const { raster: print, upscale } = prepareLineArt(raster, { boxWidthIn: box.width, boxHeightIn: box.height, targetDpi: TARGET_DPI, threshold: project.settings.generation.cleanLineArt });
  const quality = analyzeLineArt(print);
  // KDP: lines at least 0.75 pt. Convert the typical stroke width from pixels at the drawn DPI.
  const drawnDpi = Math.min(print.width / box.width, print.height / box.height);
  const strokePt = (medianStrokePx(print) / drawnDpi) * POINTS_PER_INCH;
  quality.checks.push(strokePt > 0 && strokePt < MIN_LINE_PT
    ? { id: "line_weight", status: "warning", message: `Thin lines (about ${strokePt.toFixed(2)} pt); KDP requires at least ${MIN_LINE_PT} pt. Regenerate with bolder outlines.` }
    : { id: "line_weight", status: "pass", message: strokePt ? `Line weight about ${strokePt.toFixed(1)} pt.` : "No lines measured." });
  if (quality.status === "pass" && quality.checks.some((c) => c.status === "warning")) quality.status = "warning";
  const sourceQuality = analyzeLineArt(raster);
  // Report shading found in the source even when thresholding removed it.
  if (project.settings.generation.cleanLineArt && sourceQuality.midtoneRatio > 0.45)
    quality.checks.push({ id: "source_shading", status: "pass", message: "Gray shading in the source was converted to clean line art." });
  const original = await saveAsset(app, { userId: project.user_id, projectId: project.id, kind: source.kind, bytes, mime: sniffImageMime(bytes) ?? "image/png", provider: source.provider, isDemo: source.isDemo, width: raster.width, height: raster.height, meta: source.meta, raster });
  const printBytes = encodePng(print);
  const asset = await saveAsset(app, {
    userId: project.user_id,
    projectId: project.id,
    kind: "illustration",
    bytes: printBytes,
    mime: "image/png",
    provider: source.provider,
    isDemo: source.isDemo,
    width: print.width,
    height: print.height,
    meta: { ...source.meta, sourceAssetId: original.id, upscale: Math.round(upscale * 100) / 100, thresholded: project.settings.generation.cleanLineArt, pageId: page.id },
    raster: print,
  });
  const status: PageStatus = quality.status === "pass" ? "generated" : "needs_review";
  return { asset, original, quality, status };
}
