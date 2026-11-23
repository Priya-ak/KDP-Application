import jpeg from "jpeg-js";
import { PNG } from "pngjs";

/** Decoded raster. `channels` is 1 (grayscale) or 3 (RGB); alpha is composited over white. */
export interface Raster {
  width: number;
  height: number;
  channels: 1 | 3;
  data: Uint8Array;
}

export type ImageMime = "image/png" | "image/jpeg";

/** Identifies PNG/JPEG by magic bytes; anything else is rejected. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

const MAX_PIXELS = 60_000_000;

export function decodeImage(bytes: Uint8Array): Raster {
  const mime = sniffImageMime(bytes);
  if (!mime) throw new Error("Unsupported image format. Use PNG or JPEG.");
  let width: number;
  let height: number;
  let rgba: Uint8Array;
  if (mime === "image/png") {
    const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    width = png.width;
    height = png.height;
    rgba = png.data;
  } else {
    const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1_000_000, maxMemoryUsageInMB: 1024 });
    width = img.width;
    height = img.height;
    rgba = img.data;
  }
  if (width * height > MAX_PIXELS) throw new Error("Image is too large.");
  // Composite over white and keep RGB.
  const rgb = new Uint8Array(width * height * 3);
  let grayscale = true;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]! / 255;
    const r = Math.round(rgba[i]! * a + 255 * (1 - a));
    const g = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    const b = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
    rgb[j] = r;
    rgb[j + 1] = g;
    rgb[j + 2] = b;
    if (grayscale && (Math.abs(r - g) > 6 || Math.abs(g - b) > 6)) grayscale = false;
  }
  return grayscale ? toGray({ width, height, channels: 3, data: rgb }) : { width, height, channels: 3, data: rgb };
}

export function toGray(r: Raster): Raster {
  if (r.channels === 1) return r;
  const out = new Uint8Array(r.width * r.height);
  for (let i = 0, j = 0; i < out.length; i++, j += 3) out[i] = Math.round(0.299 * r.data[j]! + 0.587 * r.data[j + 1]! + 0.114 * r.data[j + 2]!);
  return { width: r.width, height: r.height, channels: 1, data: out };
}

export function encodePng(r: Raster): Buffer {
  const png = new PNG({ width: r.width, height: r.height, colorType: r.channels === 1 ? 0 : 2, inputColorType: r.channels === 1 ? 0 : 2, inputHasAlpha: false, bitDepth: 8 });
  png.data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  return PNG.sync.write(png, { colorType: r.channels === 1 ? 0 : 2, inputColorType: r.channels === 1 ? 0 : 2, inputHasAlpha: false, bitDepth: 8 });
}

/** Area-average downscale (used for thumbnails and fast analysis). */
export function downscale(r: Raster, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(r.width, r.height));
  if (scale >= 1) return r;
  const w = Math.max(1, Math.round(r.width * scale));
  const h = Math.max(1, Math.round(r.height * scale));
  const c = r.channels;
  const out = new Uint8Array(w * h * c);
  const xRatio = r.width / w;
  const yRatio = r.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      for (let ch = 0; ch < c; ch++) {
        let sum = 0;
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += r.data[(yy * r.width + xx) * c + ch]!;
        out[(y * w + x) * c + ch] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
      }
    }
  }
  return { width: w, height: h, channels: c, data: out };
}

/** Bilinear resize to an exact size. */
export function resize(r: Raster, w: number, h: number): Raster {
  if (w === r.width && h === r.height) return r;
  if (w < r.width && h < r.height) return downscale(r, Math.max(w, h));
  const c = r.channels;
  const out = new Uint8Array(w * h * c);
  const sx = (r.width - 1) / Math.max(1, w - 1);
  const sy = (r.height - 1) / Math.max(1, h - 1);
  for (let y = 0; y < h; y++) {
    const fy = y * sy;
    const y0 = Math.floor(fy);
    const y1 = Math.min(r.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(r.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let ch = 0; ch < c; ch++) {
        const a = r.data[(y0 * r.width + x0) * c + ch]!;
        const b = r.data[(y0 * r.width + x1) * c + ch]!;
        const d = r.data[(y1 * r.width + x0) * c + ch]!;
        const e = r.data[(y1 * r.width + x1) * c + ch]!;
        out[(y * w + x) * c + ch] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return { width: w, height: h, channels: c, data: out };
}
