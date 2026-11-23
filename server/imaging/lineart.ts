import { MAX_RECOMMENDED_DPI } from "../../shared/kdp.ts";
import { downscale, resize, toGray, type Raster } from "./codec.ts";

export type QualityStatus = "pass" | "warning" | "error";

export interface QualityCheck {
  id: string;
  status: QualityStatus;
  message: string;
}

export interface QualityReport {
  width: number;
  height: number;
  inkCoverage: number;
  midtoneRatio: number;
  solidBlackRatio: number;
  edgeTouch: { top: boolean; bottom: boolean; left: boolean; right: boolean };
  checks: QualityCheck[];
  /** Worst status across checks. */
  status: QualityStatus;
}

/**
 * Automated checks for coloring-page line art. Works on a downscaled copy, so
 * it is fast enough to run after every generation. These are heuristics: they
 * catch blank pages, heavy gray shading, solid black fills and subjects cut off
 * at the image edge. They cannot detect stray text or logos (manual review).
 */
export function analyzeLineArt(input: Raster): QualityReport {
  const r = toGray(downscale(input, 600));
  const { width: w, height: h, data } = r;
  const total = w * h;
  let ink = 0;
  let nonWhite = 0;
  let mid = 0;
  for (let i = 0; i < total; i++) {
    const v = data[i]!;
    if (v < 128) ink++;
    if (v < 235) nonWhite++;
    if (v >= 70 && v <= 200) mid++;
  }
  // Solid black: dark pixel whose 5x5 neighbourhood is entirely dark.
  let solid = 0;
  for (let y = 2; y < h - 2; y += 2) {
    for (let x = 2; x < w - 2; x += 2) {
      if (data[y * w + x]! >= 60) continue;
      let all = true;
      for (let dy = -2; dy <= 2 && all; dy++) for (let dx = -2; dx <= 2; dx++) if (data[(y + dy) * w + x + dx]! >= 60) { all = false; break; }
      if (all) solid++;
    }
  }
  const sampled = Math.max(1, Math.floor((h - 4) / 2) * Math.floor((w - 4) / 2));
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.01));
  const touches = (x0: number, y0: number, x1: number, y1: number) => {
    let count = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[y * w + x]! < 128) count++;
    return count / ((x1 - x0) * (y1 - y0)) > 0.02;
  };
  const edgeTouch = { top: touches(0, 0, w, band), bottom: touches(0, h - band, w, h), left: touches(0, 0, band, h), right: touches(w - band, 0, w, h) };

  const inkCoverage = ink / total;
  const midtoneRatio = nonWhite ? mid / nonWhite : 0;
  const solidBlackRatio = solid / sampled;
  const checks: QualityCheck[] = [];
  if (inkCoverage < 0.004) checks.push({ id: "blank", status: "error", message: "The image is almost blank." });
  else if (inkCoverage > 0.5) checks.push({ id: "density", status: "warning", message: "Very dense artwork; little space left to color." });
  else checks.push({ id: "density", status: "pass", message: `Ink coverage ${(inkCoverage * 100).toFixed(1)}%.` });
  if (midtoneRatio > 0.45) checks.push({ id: "shading", status: "warning", message: "Contains noticeable gray shading. Enable clean line art or regenerate." });
  else checks.push({ id: "shading", status: "pass", message: "Clean black-and-white line art." });
  if (solidBlackRatio > 0.06) checks.push({ id: "solid_black", status: "warning", message: "Large solid black areas waste ink and can't be colored." });
  else checks.push({ id: "solid_black", status: "pass", message: "No large solid fills." });
  const touched = Object.entries(edgeTouch).filter(([, v]) => v).map(([k]) => k);
  // Ground lines legitimately run to the sides and bottom; ink along the top edge plus a side suggests a cropped subject.
  if (edgeTouch.top && touched.length >= 2) checks.push({ id: "edges", status: "warning", message: `Artwork touches the ${touched.join(" and ")} edge(s); the subject may be cut off.` });
  else checks.push({ id: "edges", status: "pass", message: "Subject sits inside the frame." });
  const status: QualityStatus = checks.some((c) => c.status === "error") ? "error" : checks.some((c) => c.status === "warning") ? "warning" : "pass";
  return { width: input.width, height: input.height, inkCoverage, midtoneRatio, solidBlackRatio, edgeTouch, checks, status };
}

export interface PrepareOptions {
  /** Size of the box the image will be printed in (inches). */
  boxWidthIn: number;
  boxHeightIn: number;
  targetDpi: number;
  /** Threshold to pure black and white (removes gray shading and JPEG noise). */
  threshold: boolean;
  /** Never upscale more than this factor (beyond it, upscaling only hides a weak source). */
  maxUpscale?: number;
}

/**
 * Converts generated art into a print-ready grayscale raster: upscales (bilinear)
 * to the target DPI for the box it will occupy, then optionally thresholds.
 * Line art survives bilinear upscaling + thresholding well; photos would not.
 */
export function prepareLineArt(input: Raster, opts: PrepareOptions): { raster: Raster; upscale: number } {
  let gray = toGray(input);
  // Above KDP's recommended 600 DPI ceiling, files get large and can time out in processing.
  const sourceDpi = Math.min(gray.width / opts.boxWidthIn, gray.height / opts.boxHeightIn);
  if (sourceDpi > MAX_RECOMMENDED_DPI) gray = downscale(gray, Math.round(Math.max(gray.width, gray.height) * (MAX_RECOMMENDED_DPI / sourceDpi)));
  const scaleToFit = Math.min(opts.boxWidthIn / gray.width, opts.boxHeightIn / gray.height); // inches per pixel when fitted
  const currentDpi = 1 / scaleToFit;
  // 2% headroom so pixel rounding never lands just under the target.
  const needed = (opts.targetDpi * 1.02) / currentDpi;
  const upscale = Math.min(opts.maxUpscale ?? 4, Math.max(1, needed));
  const longest = Math.max(gray.width, gray.height) * upscale;
  const capped = longest > 6000 ? (6000 / Math.max(gray.width, gray.height)) : upscale;
  const w = Math.round(gray.width * capped);
  const h = Math.round(gray.height * capped);
  let out = capped > 1.0001 ? resize(gray, w, h) : gray;
  if (opts.threshold) {
    const data = new Uint8Array(out.data.length);
    for (let i = 0; i < data.length; i++) data[i] = out.data[i]! < 170 ? 0 : 255;
    out = { width: out.width, height: out.height, channels: 1, data };
  }
  return { raster: out, upscale: capped };
}

/**
 * Typical stroke width of black line art in pixels: the median length of horizontal and vertical dark
 * runs, ignoring long runs (filled areas). KDP requires lines of at least 0.75 pt.
 */
export function medianStrokePx(r: Raster): number {
  const g = toGray(r);
  const counts = new Map<number, number>();
  const bump = (len: number) => {
    if (len > 0 && len <= 40) counts.set(len, (counts.get(len) ?? 0) + 1);
  };
  const stepY = Math.max(1, Math.floor(g.height / 400));
  for (let y = 0; y < g.height; y += stepY) {
    let run = 0;
    for (let x = 0; x < g.width; x++) {
      if (g.data[y * g.width + x]! < 128) run++;
      else {
        bump(run);
        run = 0;
      }
    }
    bump(run);
  }
  const stepX = Math.max(1, Math.floor(g.width / 400));
  for (let x = 0; x < g.width; x += stepX) {
    let run = 0;
    for (let y = 0; y < g.height; y++) {
      if (g.data[y * g.width + x]! < 128) run++;
      else {
        bump(run);
        run = 0;
      }
    }
    bump(run);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let acc = 0;
  for (const len of [...counts.keys()].sort((a, b) => a - b)) {
    acc += counts.get(len)!;
    if (acc >= total / 2) return len;
  }
  return 0;
}
