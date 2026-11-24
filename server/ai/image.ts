import type { AppConfig } from "../config.ts";
import { JobError, kindForStatus, parseRetryAfter } from "../errors.ts";
import { decodeImage, encodePng, type Raster } from "../imaging/codec.ts";
import { demoCoverArt, demoLineArt } from "./demo-art.ts";

export type ImageKind = "line_art" | "cover" | "character";
export type AspectRatio = "portrait" | "square" | "landscape";
export type ImageQuality = "draft" | "standard" | "high";

export interface GenerateIllustrationInput {
  prompt: string;
  kind: ImageKind;
  aspectRatio: AspectRatio;
  quality: ImageQuality;
  /** PNG bytes of approved character references (used only by providers that support conditioning). */
  referenceImages: Buffer[];
  outputFormat: "png";
  /** Deterministic seed for providers that support it (demo). */
  seed: string;
  /** Hints for the demo renderer only. */
  theme: string;
  complexity: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  mime: "image/png";
  usedReferences: boolean;
  revisedPrompt?: string;
}

/** Provider-independent image generation interface. */
export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  readonly isDemo: boolean;
  readonly supportsReferences: boolean;
  generateIllustration(input: GenerateIllustrationInput, signal?: AbortSignal): Promise<GeneratedImage>;
}

const OPENAI_SIZES: Record<AspectRatio, string> = { portrait: "1024x1536", square: "1024x1024", landscape: "1536x1024" };
const OPENAI_QUALITY: Record<ImageQuality, string> = { draft: "low", standard: "medium", high: "high" };

/**
 * OpenAI Images API (gpt-image family). Text-to-image uses /images/generations;
 * when approved character references are supplied it uses /images/edits with
 * the references as input images, which conditions the character design.
 * The key stays server-side (OPENAI_API_KEY).
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  readonly isDemo = false;
  readonly supportsReferences = true;

  constructor(private readonly config: AppConfig["ai"]) {}

  get model() {
    return this.config.openaiImageModel;
  }

  async generateIllustration(input: GenerateIllustrationInput, signal?: AbortSignal): Promise<GeneratedImage> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new JobError("config", "OPENAI_API_KEY is not configured.");
    const timeout = AbortSignal.timeout(this.config.imageTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const useRefs = input.referenceImages.length > 0;
    let res: Response;
    try {
      if (useRefs) {
        const form = new FormData();
        form.set("model", this.model);
        form.set("prompt", input.prompt);
        form.set("size", OPENAI_SIZES[input.aspectRatio]);
        form.set("quality", OPENAI_QUALITY[input.quality]);
        form.set("n", "1");
        input.referenceImages.slice(0, 4).forEach((img, i) => form.append("image[]", new Blob([new Uint8Array(img)], { type: "image/png" }), `reference-${i}.png`));
        res = await fetch(`${this.config.openaiBaseUrl}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: combined });
      } else {
        res = await fetch(`${this.config.openaiBaseUrl}/images/generations`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: input.prompt, size: OPENAI_SIZES[input.aspectRatio], quality: OPENAI_QUALITY[input.quality], n: 1, output_format: "png" }),
          signal: combined,
        });
      }
    } catch (err) {
      if (signal?.aborted) throw new JobError("cancelled", "Generation was cancelled.");
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new JobError("timeout", "The image provider timed out.");
      throw new JobError("transient", "Could not reach the image provider.");
    }
    const text = await res.text();
    if (!res.ok) {
      let message = `Image provider error (${res.status}).`;
      let code = "";
      try {
        const body = JSON.parse(text) as { error?: { message?: string; code?: string } };
        code = body.error?.code ?? "";
        if (body.error?.message) message = `Image provider: ${body.error.message.slice(0, 300)}`;
      } catch {
        // non-JSON error body
      }
      if (code === "moderation_blocked" || /safety|moderation/i.test(code)) throw new JobError("content_policy", "The image provider's safety system blocked this prompt. Edit the prompt and try again.");
      throw new JobError(kindForStatus(res.status), message, parseRetryAfter(res.headers.get("retry-after")));
    }
    let b64: string | undefined;
    let revised: string | undefined;
    try {
      const body = JSON.parse(text) as { data?: Array<{ b64_json?: string; revised_prompt?: string }> };
      b64 = body.data?.[0]?.b64_json;
      revised = body.data?.[0]?.revised_prompt;
    } catch {
      throw new JobError("transient", "The image provider returned an unreadable response.");
    }
    if (!b64) throw new JobError("transient", "The image provider returned no image.");
    return { bytes: Buffer.from(b64, "base64"), mime: "image/png", usedReferences: useRefs, revisedPrompt: revised };
  }
}


const CF_SIZES: Record<AspectRatio, [number, number]> = { portrait: [832, 1216], square: [1024, 1024], landscape: [1216, 832] };
const CF_PREFIX = "Black and white coloring book page, clean smooth black outlines on a pure white background, no shading, no gray, no filled black areas, no text. ";

/** Centre a raster on a white canvas of the requested aspect ratio (for models that only produce squares). */
function padToAspect(r: Raster, aspect: AspectRatio): Raster {
  const ratio = aspect === "portrait" ? 1216 / 832 : aspect === "landscape" ? 832 / 1216 : 1;
  const w = ratio < 1 ? Math.round(r.height / ratio) : r.width;
  const h = ratio < 1 ? r.height : Math.round(r.width * ratio);
  if (w === r.width && h === r.height) return r;
  const out = new Uint8Array(w * h * r.channels).fill(255);
  const x0 = Math.floor((w - r.width) / 2);
  const y0 = Math.floor((h - r.height) / 2);
  for (let y = 0; y < r.height; y++) {
    const src = y * r.width * r.channels;
    out.set(r.data.subarray(src, src + r.width * r.channels), ((y + y0) * w + x0) * r.channels);
  }
  return { width: w, height: h, channels: r.channels, data: out };
}

/**
 * Cloudflare Workers AI (free daily allowance). REST: POST /accounts/{id}/ai/run/{model}.
 * FLUX models answer JSON {result:{image:<base64 jpeg>}} and only draw squares (we pad to the page shape);
 * Stable Diffusion models answer raw image bytes and accept width/height. Character references are not supported.
 * Credentials stay server-side (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).
 */
export class CloudflareImageProvider implements ImageProvider {
  readonly name = "cloudflare";
  readonly isDemo = false;
  readonly supportsReferences = false;

  constructor(private readonly config: AppConfig["ai"]) {}

  get model() {
    return this.config.cloudflareImageModel;
  }

  async generateIllustration(input: GenerateIllustrationInput, signal?: AbortSignal): Promise<GeneratedImage> {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!token || !account) throw new JobError("config", "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be configured.");
    const timeout = AbortSignal.timeout(this.config.imageTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const isFlux = /flux/i.test(this.model);
    const prompt = (CF_PREFIX + input.prompt).slice(0, 2000);
    const body: Record<string, unknown> = { prompt };
    if (isFlux) {
      body.steps = input.quality === "draft" ? 4 : 8;
    } else {
      const [width, height] = CF_SIZES[input.aspectRatio];
      body.width = width;
      body.height = height;
      body.negative_prompt = "color, colour, shading, gray, grayscale fill, solid black areas, text, watermark, photo, blurry";
    }
    let res: Response;
    try {
      res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${this.model}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      if (signal?.aborted) throw new JobError("cancelled", "Generation was cancelled.");
      const name = (err as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new JobError("timeout", "The image provider timed out.");
      throw new JobError("transient", "Could not reach the image provider.");
    }
    if (!res.ok) {
      let message = `Cloudflare image error (${res.status}).`;
      try {
        const err = JSON.parse(await res.text()) as { errors?: Array<{ message?: string }> };
        const first = err.errors?.[0]?.message;
        if (first) message = `Cloudflare image error (${res.status}): ${first.slice(0, 250)}`;
      } catch {
        // non-JSON error body
      }
      throw new JobError(kindForStatus(res.status), message, parseRetryAfter(res.headers.get("retry-after")));
    }
    let raw: Buffer;
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      let b64: string | undefined;
      try {
        const json = (await res.json()) as { result?: { image?: string }; image?: string };
        b64 = json.result?.image ?? json.image;
      } catch {
        throw new JobError("transient", "The image provider returned an unreadable response.");
      }
      if (!b64) throw new JobError("transient", "The image provider returned no image.");
      raw = Buffer.from(b64, "base64");
    } else {
      raw = Buffer.from(await res.arrayBuffer());
    }
    let raster: Raster;
    try {
      raster = decodeImage(raw);
    } catch {
      throw new JobError("transient", "The image provider returned an image that could not be read.");
    }
    return { bytes: encodePng(padToAspect(raster, input.aspectRatio)), mime: "image/png", usedReferences: false };
  }
}

/** Demo provider: procedural placeholder art, stamped "DEMO". Never presented as AI output. */
export class DemoImageProvider implements ImageProvider {
  readonly name = "demo";
  readonly model = "procedural-placeholder";
  readonly isDemo = true;
  readonly supportsReferences = false;

  constructor(private readonly scale = 0.5) {}

  async generateIllustration(input: GenerateIllustrationInput): Promise<GeneratedImage> {
    const [w, h] = (OPENAI_SIZES[input.aspectRatio].split("x").map(Number) as [number, number]).map((n) => Math.round(n * this.scale * 2)) as [number, number];
    const raster =
      input.kind === "cover"
        ? demoCoverArt({ seed: input.seed, theme: input.theme, width: w, height: h })
        : demoLineArt({ seed: input.seed, theme: input.theme, complexity: input.kind === "character" ? "simple" : input.complexity, width: w, height: h });
    // Yield to the event loop so a batch of demo pages doesn't starve HTTP requests.
    await new Promise((r) => setImmediate(r));
    return { bytes: encodePng(raster), mime: "image/png", usedReferences: false };
  }
}

export function createImageProvider(config: AppConfig): ImageProvider {
  if (config.ai.imageProvider === "openai") return new OpenAIImageProvider(config.ai);
  if (config.ai.imageProvider === "cloudflare") return new CloudflareImageProvider(config.ai);
  return new DemoImageProvider(config.ai.demoImageScale);
}
