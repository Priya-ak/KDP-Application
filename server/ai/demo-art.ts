import type { Raster } from "../imaging/codec.ts";
import { Canvas, seededRandom, type Color } from "../imaging/raster.ts";

/**
 * Procedural placeholder artwork for DEMO MODE (no image provider configured).
 * It is not AI-generated: every image is stamped "DEMO", stored with
 * provider = "demo", and labelled as placeholder art in the UI and the
 * validation report. It exists so the full workflow (layout, PDF export,
 * validation) can be exercised without credentials.
 */

type Pt = [number, number];
type Motif = "meadow" | "ocean" | "space" | "garden" | "town";

export function motifForTheme(theme: string): Motif {
  const t = theme.toLowerCase();
  if (/(ocean|sea|fish|whale|shark|mermaid|underwater|turtle|coral)/.test(t)) return "ocean";
  if (/(space|planet|rocket|astronaut|star|galaxy|moon|alien)/.test(t)) return "space";
  if (/(flower|garden|mandala|pattern|butterfl|floral|bloom)/.test(t)) return "garden";
  if (/(city|town|house|cottage|car|truck|vehicle|train|village)/.test(t)) return "town";
  return "meadow";
}

const strokeFor = (w: number, complexity: string) => w * (complexity === "simple" ? 0.011 : complexity === "detailed" ? 0.0045 : 0.007);

function creature(c: Canvas, cx: number, cy: number, s: number, lw: number, rnd: () => number, fill: Color = 255, accent: Color = 255) {
  const earStyle = Math.floor(rnd() * 3);
  // feet
  c.ellipse(cx - s * 0.32, cy + s * 0.78, s * 0.22, s * 0.12, lw, fill);
  c.ellipse(cx + s * 0.32, cy + s * 0.78, s * 0.22, s * 0.12, lw, fill);
  // body
  c.ellipse(cx, cy + s * 0.35, s * 0.55, s * 0.5, lw, fill);
  c.ellipse(cx, cy + s * 0.42, s * 0.32, s * 0.3, lw * 0.8, accent);
  // ears
  if (earStyle === 0) {
    c.ellipse(cx - s * 0.32, cy - s * 0.62, s * 0.12, s * 0.3, lw, fill, -0.3);
    c.ellipse(cx + s * 0.32, cy - s * 0.62, s * 0.12, s * 0.3, lw, fill, 0.3);
  } else if (earStyle === 1) {
    c.ellipse(cx - s * 0.38, cy - s * 0.45, s * 0.16, s * 0.16, lw, fill);
    c.ellipse(cx + s * 0.38, cy - s * 0.45, s * 0.16, s * 0.16, lw, fill);
  } else {
    c.shape([[cx - s * 0.45, cy - s * 0.3], [cx - s * 0.35, cy - s * 0.75], [cx - s * 0.12, cy - s * 0.42]], lw, fill);
    c.shape([[cx + s * 0.45, cy - s * 0.3], [cx + s * 0.35, cy - s * 0.75], [cx + s * 0.12, cy - s * 0.42]], lw, fill);
  }
  // head
  c.ellipse(cx, cy - s * 0.2, s * 0.45, s * 0.4, lw, fill);
  // eyes
  for (const dx of [-0.16, 0.16]) {
    c.ellipse(cx + s * dx, cy - s * 0.26, s * 0.075, s * 0.09, lw * 0.7, 255);
    c.disc(cx + s * dx + s * 0.015, cy - s * 0.25, s * 0.04, 0);
  }
  // smile
  const smile: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = Math.PI * (0.15 + 0.7 * (i / 12));
    smile.push([cx + Math.cos(t) * s * 0.14, cy - s * 0.12 + Math.sin(t) * s * 0.1]);
  }
  c.polyline(smile, lw * 0.8);
  // arms
  c.ellipse(cx - s * 0.55, cy + s * 0.28, s * 0.1, s * 0.2, lw, fill, 0.6);
  c.ellipse(cx + s * 0.55, cy + s * 0.28, s * 0.1, s * 0.2, lw, fill, -0.6);
}

function flower(c: Canvas, cx: number, cy: number, r: number, lw: number, petals: number, stem = true) {
  if (stem) {
    c.line([cx, cy], [cx, cy + r * 3], lw);
    c.ellipse(cx + r * 0.6, cy + r * 1.9, r * 0.6, r * 0.25, lw, 255, -0.5);
  }
  for (let i = 0; i < petals; i++) {
    const t = (i / petals) * Math.PI * 2;
    c.ellipse(cx + Math.cos(t) * r * 0.75, cy + Math.sin(t) * r * 0.75, r * 0.5, r * 0.3, lw, 255, t);
  }
  c.ellipse(cx, cy, r * 0.42, r * 0.42, lw, 255);
}

function tree(c: Canvas, x: number, ground: number, s: number, lw: number) {
  c.shape([[x - s * 0.12, ground], [x - s * 0.08, ground - s * 0.7], [x + s * 0.08, ground - s * 0.7], [x + s * 0.12, ground]], lw);
  for (const [dx, dy, r] of [[-0.25, -0.95, 0.3], [0.25, -0.95, 0.3], [0, -1.2, 0.38]] as const) c.ellipse(x + s * dx, ground + s * dy, s * r, s * r * 0.85, lw);
}

function cloud(c: Canvas, x: number, y: number, s: number, lw: number) {
  const pts: Pt[] = [];
  const bumps = 5;
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * Math.PI * 2;
    const bump = 1 + 0.18 * Math.max(0, Math.sin(t * bumps));
    pts.push([x + Math.cos(t) * s * bump, y + Math.sin(t) * s * 0.5 * (t > Math.PI ? bump : 1)]);
  }
  c.shape(pts, lw);
}

function sun(c: Canvas, x: number, y: number, r: number, lw: number) {
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * Math.PI * 2;
    c.line([x + Math.cos(t) * r * 1.3, y + Math.sin(t) * r * 1.3], [x + Math.cos(t) * r * 1.75, y + Math.sin(t) * r * 1.75], lw);
  }
  c.ellipse(x, y, r, r, lw);
}

function star(c: Canvas, x: number, y: number, r: number, lw: number) {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([x + Math.cos(t) * rr, y + Math.sin(t) * rr]);
  }
  c.shape(pts, lw);
}

function fish(c: Canvas, x: number, y: number, s: number, lw: number, flip: boolean) {
  const d = flip ? -1 : 1;
  c.shape([[x - d * s * 0.9, y], [x - d * s * 1.35, y - s * 0.4], [x - d * s * 1.35, y + s * 0.4]], lw);
  c.ellipse(x, y, s, s * 0.55, lw);
  c.disc(x + d * s * 0.5, y - s * 0.1, s * 0.09, 0);
  c.line([x - d * s * 0.1, y - s * 0.5], [x - d * s * 0.1, y + s * 0.5], lw * 0.7);
}

function house(c: Canvas, x: number, ground: number, s: number, lw: number) {
  c.shape([[x - s * 0.5, ground], [x - s * 0.5, ground - s * 0.7], [x + s * 0.5, ground - s * 0.7], [x + s * 0.5, ground]], lw);
  c.shape([[x - s * 0.62, ground - s * 0.68], [x, ground - s * 1.15], [x + s * 0.62, ground - s * 0.68]], lw);
  c.shape([[x - s * 0.12, ground], [x - s * 0.12, ground - s * 0.38], [x + s * 0.12, ground - s * 0.38], [x + s * 0.12, ground]], lw);
  c.shape([[x + s * 0.22, ground - s * 0.5], [x + s * 0.42, ground - s * 0.5], [x + s * 0.42, ground - s * 0.32], [x + s * 0.22, ground - s * 0.32]], lw);
  c.ellipse(x - s * 0.32, ground - s * 0.42, s * 0.1, s * 0.1, lw);
}

function mandala(c: Canvas, cx: number, cy: number, r: number, lw: number, rnd: () => number) {
  const rings = 4 + Math.floor(rnd() * 2);
  for (let k = rings; k >= 1; k--) {
    const rr = (r * k) / rings;
    const n = 6 + k * 2;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + (k % 2 ? 0 : Math.PI / n);
      c.ellipse(cx + Math.cos(t) * rr * 0.8, cy + Math.sin(t) * rr * 0.8, rr / rings * 0.9, rr / rings * 0.45, lw, 255, t);
    }
    c.ellipse(cx, cy, rr * 0.62, rr * 0.62, lw, k === 1 ? 255 : null);
  }
}

export interface DemoArtOptions {
  seed: string;
  theme: string;
  complexity: string;
  width: number;
  height: number;
}

/** Black-and-white placeholder coloring page. */
export function demoLineArt(opts: DemoArtOptions): Raster {
  const { width: W, height: H } = opts;
  const c = new Canvas(W, H, 1, 255);
  const rnd = seededRandom(opts.seed);
  const lw = strokeFor(W, opts.complexity);
  const motif = motifForTheme(opts.theme);
  const extra = opts.complexity === "simple" ? 0 : opts.complexity === "medium" ? 2 : 4;
  const ground = H * (0.78 + rnd() * 0.06);
  const pad = W * 0.05;

  if (motif === "garden" && /mandala|pattern/.test(opts.theme.toLowerCase())) {
    mandala(c, W / 2, H / 2, W * 0.42, lw, rnd);
  } else if (motif === "space") {
    for (let i = 0; i < 4 + extra * 2; i++) star(c, pad + rnd() * (W - 2 * pad), pad + rnd() * H * 0.5, W * (0.025 + rnd() * 0.02), lw);
    c.ellipse(W * 0.22, H * 0.25, W * 0.13, W * 0.13, lw);
    c.ellipse(W * 0.22, H * 0.25, W * 0.22, W * 0.05, lw, null, -0.3);
    c.ellipse(W * 0.8, H * 0.18, W * 0.07, W * 0.07, lw);
    const surface: Pt[] = [[0, H], [0, ground]];
    for (let i = 0; i <= 20; i++) surface.push([(W * i) / 20, ground + Math.sin(i * 1.3 + rnd()) * H * 0.012]);
    surface.push([W, H]);
    c.shape(surface, lw);
    for (let i = 0; i < 3 + extra; i++) c.ellipse(pad + rnd() * (W - 2 * pad), ground + H * (0.04 + rnd() * 0.1), W * 0.04, W * 0.015, lw);
    creature(c, W * 0.55, ground - W * 0.33, W * 0.26, lw, rnd);
  } else if (motif === "ocean") {
    for (let i = 0; i < 5 + extra * 2; i++) c.ellipse(pad + rnd() * (W - 2 * pad), pad + rnd() * H * 0.6, W * 0.015, W * 0.015, lw * 0.8);
    const sand: Pt[] = [[0, H], [0, ground]];
    for (let i = 0; i <= 16; i++) sand.push([(W * i) / 16, ground + Math.sin(i * 0.9) * H * 0.015]);
    sand.push([W, H]);
    c.shape(sand, lw);
    for (let i = 0; i < 3 + extra; i++) {
      const x = pad + rnd() * (W - 2 * pad);
      const pts: Pt[] = [];
      for (let k = 0; k <= 10; k++) pts.push([x + Math.sin(k * 0.9) * W * 0.02, ground - (H * 0.22 * k) / 10]);
      c.polyline(pts, lw);
    }
    fish(c, W * 0.28, H * 0.3, W * 0.1, lw, false);
    fish(c, W * 0.75, H * 0.45, W * 0.07, lw, true);
    if (extra) fish(c, W * 0.7, H * 0.2, W * 0.05, lw, false);
    creature(c, W * 0.45, ground - W * 0.3, W * 0.24, lw, rnd);
  } else {
    sun(c, W * 0.8, H * 0.14, W * 0.07, lw);
    cloud(c, W * 0.25, H * 0.13, W * 0.12, lw);
    if (extra) cloud(c, W * 0.55, H * 0.22, W * 0.08, lw);
    const hill: Pt[] = [[0, H], [0, ground - H * 0.08]];
    for (let i = 0; i <= 20; i++) hill.push([(W * i) / 20, ground - H * 0.08 - Math.sin((i / 20) * Math.PI) * H * 0.07]);
    hill.push([W, H]);
    c.shape(hill, lw);
    const groundLine: Pt[] = [[0, H], [0, ground]];
    for (let i = 0; i <= 20; i++) groundLine.push([(W * i) / 20, ground + Math.sin(i * 0.8) * H * 0.008]);
    groundLine.push([W, H]);
    c.shape(groundLine, lw);
    if (motif === "town") {
      house(c, W * 0.2, ground, W * 0.25, lw);
      if (extra) house(c, W * 0.82, ground, W * 0.18, lw);
    } else {
      tree(c, W * 0.15, ground, W * 0.28, lw);
      if (extra) tree(c, W * 0.88, ground, W * 0.2, lw);
    }
    const flowers = 2 + extra;
    for (let i = 0; i < flowers; i++) flower(c, pad + rnd() * (W - 2 * pad), ground + H * (0.04 + rnd() * 0.08), W * 0.03, lw, 5 + Math.floor(rnd() * 3));
    if (motif === "garden") flower(c, W * 0.72, ground - W * 0.35, W * 0.09, lw, 8);
    creature(c, motif === "garden" ? W * 0.38 : W * 0.52, ground - W * 0.33, W * 0.27, lw, rnd);
  }
  c.label("DEMO", Math.round(W * 0.86), Math.round(H * 0.965), Math.max(1, Math.round(W * 0.0035)), 90);
  return c.toRaster();
}

const PALETTES: Array<[number, number, number][]> = [
  [[255, 214, 102], [255, 122, 89], [120, 200, 160], [110, 160, 255], [255, 170, 200]],
  [[178, 226, 255], [255, 196, 87], [255, 129, 160], [140, 220, 140], [190, 160, 255]],
  [[255, 236, 180], [244, 120, 90], [94, 190, 200], [250, 200, 70], [160, 130, 230]],
];

/** Full-color placeholder front-cover artwork (no title text; titles are typeset separately). */
export function demoCoverArt(opts: Omit<DemoArtOptions, "complexity">): Raster {
  const { width: W, height: H } = opts;
  const c = new Canvas(W, H, 3, [255, 255, 255]);
  const rnd = seededRandom(`cover:${opts.seed}`);
  const pal = PALETTES[Math.floor(rnd() * PALETTES.length)]!;
  c.gradient([pal[0]![0], pal[0]![1], pal[0]![2]], [255, 250, 240]);
  const lw = W * 0.008;
  const ink: Color = [40, 30, 70];
  for (let i = 0; i < 6; i++) {
    const p = pal[1 + (i % 4)]!;
    c.ellipse(rnd() * W, rnd() * H * 0.45, W * (0.03 + rnd() * 0.05), W * (0.03 + rnd() * 0.05), lw * 0.6, p, 0, ink);
  }
  const ground = H * 0.8;
  const hill: Pt[] = [[0, H], [0, ground]];
  for (let i = 0; i <= 24; i++) hill.push([(W * i) / 24, ground - Math.sin((i / 24) * Math.PI) * H * 0.08]);
  hill.push([W, H]);
  c.shape(hill, lw, pal[2]!, ink);
  creature(c, W * 0.5, ground - W * 0.3, W * 0.3, lw, rnd, pal[1]!, pal[4]!);
  c.label("DEMO", Math.round(W * 0.84), Math.round(H * 0.955), Math.max(1, Math.round(W * 0.004)), [90, 90, 90]);
  return c.toRaster();
}
