import type { Raster } from "./codec.ts";

export type Color = number | [number, number, number];
type Pt = [number, number];

/**
 * Tiny anti-aliased software rasterizer (strokes, fills) used only to draw the
 * clearly-labelled demo artwork when no image provider is configured.
 */
export class Canvas {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly channels: 1 | 3,
    background: Color = 255,
  ) {
    this.data = new Uint8Array(width * height * channels);
    this.fillRect(0, 0, width, height, background);
  }

  toRaster(): Raster {
    return { width: this.width, height: this.height, channels: this.channels, data: this.data };
  }

  private blend(x: number, y: number, color: Color, alpha: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || alpha <= 0) return;
    const a = Math.min(1, alpha);
    const i = (y * this.width + x) * this.channels;
    if (this.channels === 1) {
      const c = typeof color === "number" ? color : Math.round(0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]);
      this.data[i] = Math.round(this.data[i]! * (1 - a) + c * a);
    } else {
      const c = typeof color === "number" ? [color, color, color] : color;
      for (let k = 0; k < 3; k++) this.data[i + k] = Math.round(this.data[i + k]! * (1 - a) + c[k]! * a);
    }
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color) {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, color, 1);
  }

  /** Vertical gradient fill (RGB canvases). */
  gradient(top: [number, number, number], bottom: [number, number, number]) {
    for (let y = 0; y < this.height; y++) {
      const t = y / Math.max(1, this.height - 1);
      const c: [number, number, number] = [0, 1, 2].map((k) => Math.round(top[k]! * (1 - t) + bottom[k]! * t)) as [number, number, number];
      for (let x = 0; x < this.width; x++) this.blend(x, y, c, 1);
    }
  }

  line(a: Pt, b: Pt, width: number, color: Color = 0) {
    const hw = width / 2;
    const x0 = Math.floor(Math.min(a[0], b[0]) - hw - 1);
    const x1 = Math.ceil(Math.max(a[0], b[0]) + hw + 1);
    const y0 = Math.floor(Math.min(a[1], b[1]) - hw - 1);
    const y1 = Math.ceil(Math.max(a[1], b[1]) + hw + 1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy || 1;
    for (let y = Math.max(0, y0); y <= Math.min(this.height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.width - 1, x1); x++) {
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
        const px = a[0] + t * dx - x;
        const py = a[1] + t * dy - y;
        const d = Math.sqrt(px * px + py * py);
        const cov = hw - d + 0.5;
        if (cov > 0) this.blend(x, y, color, cov);
      }
    }
  }

  polyline(points: Pt[], width: number, closed = false, color: Color = 0) {
    for (let i = 0; i < points.length - 1; i++) this.line(points[i]!, points[i + 1]!, width, color);
    if (closed && points.length > 2) this.line(points[points.length - 1]!, points[0]!, width, color);
    // Round joins.
    for (const p of points) this.disc(p[0], p[1], width / 2, color);
  }

  disc(cx: number, cy: number, r: number, color: Color) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        const cov = r - d + 0.5;
        if (cov > 0) this.blend(x, y, color, cov);
      }
    }
  }

  ellipsePoints(cx: number, cy: number, rx: number, ry: number, rotation = 0, steps = 72): Pt[] {
    const pts: Pt[] = [];
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const x = Math.cos(t) * rx;
      const y = Math.sin(t) * ry;
      pts.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
    }
    return pts;
  }

  /** Even-odd scanline polygon fill with 4x vertical supersampling. */
  fillPolygon(points: Pt[], color: Color) {
    if (points.length < 3) return;
    const ys = points.map((p) => p[1]);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    const S = 4;
    const cover = new Float32Array(this.width);
    for (let y = minY; y <= maxY; y++) {
      cover.fill(0);
      let any = false;
      for (let s = 0; s < S; s++) {
        const sy = y + (s + 0.5) / S;
        const xs: number[] = [];
        for (let i = 0; i < points.length; i++) {
          const p = points[i]!;
          const q = points[(i + 1) % points.length]!;
          if ((p[1] <= sy && q[1] > sy) || (q[1] <= sy && p[1] > sy)) xs.push(p[0] + ((sy - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
        }
        xs.sort((m, n) => m - n);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, xs[k]!);
          const xb = Math.min(this.width, xs[k + 1]!);
          for (let x = Math.floor(xa); x < Math.ceil(xb); x++) {
            const c = Math.min(x + 1, xb) - Math.max(x, xa);
            if (c > 0) {
              cover[x]! += c / S;
              any = true;
            }
          }
        }
      }
      if (any) for (let x = 0; x < this.width; x++) if (cover[x]! > 0) this.blend(x, y, color, cover[x]!);
    }
  }

  shape(points: Pt[], stroke: number, fill: Color | null = 255, color: Color = 0) {
    if (fill !== null) this.fillPolygon(points, fill);
    this.polyline(points, stroke, true, color);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, stroke: number, fill: Color | null = 255, rotation = 0, color: Color = 0) {
    this.shape(this.ellipsePoints(cx, cy, rx, ry, rotation), stroke, fill, color);
  }

  /** 5x7 bitmap label (used to stamp "DEMO" on placeholder artwork). */
  label(text: string, x: number, y: number, cell: number, color: Color = 0) {
    let cx = x;
    for (const ch of text.toUpperCase()) {
      const glyph = GLYPHS[ch];
      if (glyph) {
        glyph.forEach((row, ry) => {
          for (let rx = 0; rx < 5; rx++) if (row & (1 << (4 - rx))) this.fillRect(cx + rx * cell, y + ry * cell, cell, cell, color);
        });
      }
      cx += cell * 6;
    }
  }
}

const GLYPHS: Record<string, number[]> = {
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

/** Deterministic PRNG so the same seed always draws the same demo page. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
