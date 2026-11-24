import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CloudflareImageProvider, createImageProvider } from "../server/ai/image.ts";
import { decodeImage, encodePng } from "../server/imaging/codec.ts";
import { loadConfig } from "../server/config.ts";
import { JobError } from "../server/errors.ts";

/** Mocked Cloudflare Workers AI HTTP API: these tests do NOT call the live service. */
const cfg = loadConfig({ NODE_ENV: "test", IMAGE_PROVIDER: "cloudflare" });
const input = { prompt: "a friendly triceratops", kind: "line_art" as const, aspectRatio: "portrait" as const, quality: "draft" as const, referenceImages: [], outputFormat: "png" as const, seed: "s", theme: "t", complexity: "simple" };
const square = encodePng({ width: 64, height: 64, channels: 1, data: new Uint8Array(64 * 64).fill(128) });

describe("Cloudflare image provider (mocked HTTP)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = "cf_test";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct123";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
  });

  test("is auto-selected only when both credentials are set and no OpenAI key exists", () => {
    expect(loadConfig({ NODE_ENV: "test", CLOUDFLARE_API_TOKEN: "a", CLOUDFLARE_ACCOUNT_ID: "b" }).ai.imageProvider).toBe("cloudflare");
    expect(loadConfig({ NODE_ENV: "test", CLOUDFLARE_API_TOKEN: "a" }).ai.imageProvider).toBe("demo");
    expect(loadConfig({ NODE_ENV: "test", CLOUDFLARE_API_TOKEN: "a", CLOUDFLARE_ACCOUNT_ID: "b", OPENAI_API_KEY: "k" }).ai.imageProvider).toBe("openai");
    expect(createImageProvider(cfg).name).toBe("cloudflare");
  });

  test("FLUX: sends prompt+steps with the token in the header, pads the square result to a portrait page", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ result: { image: square.toString("base64") }, success: true }), { headers: { "content-type": "application/json" } }));
    const out = await new CloudflareImageProvider(cfg.ai).generateIllustration(input);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/@cf/black-forest-labs/flux-1-schnell");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer cf_test");
    const sent = JSON.parse(init.body as string);
    expect(sent.prompt).toContain("a friendly triceratops");
    expect(sent.steps).toBe(4);
    expect(sent.width).toBeUndefined();
    const r = decodeImage(out.bytes);
    expect(r.height).toBeGreaterThan(r.width);
    expect(out.mime).toBe("image/png");
  });

  test("Stable Diffusion models get width/height and a negative prompt, and raw image bytes are accepted", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(square), { headers: { "content-type": "image/png" } }));
    const sd = new CloudflareImageProvider({ ...cfg.ai, cloudflareImageModel: "@cf/stabilityai/stable-diffusion-xl-base-1.0" });
    await sd.generateIllustration(input);
    const sent = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(sent).toMatchObject({ width: 832, height: 1216 });
    expect(sent.negative_prompt).toMatch(/shading/);
  });

  test("maps API failures to retryable / permanent job errors without leaking the token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: [{ message: "Rate limit exceeded" }] }), { status: 429 }));
    const err = await new CloudflareImageProvider(cfg.ai).generateIllustration(input).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(String(err.message)).toContain("Rate limit exceeded");
    expect(String(err.message)).not.toContain("cf_test");
  });

  test("fails with a config error when credentials are missing", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const err = await new CloudflareImageProvider(cfg.ai).generateIllustration(input).catch((e) => e);
    expect(err.kind).toBe("config");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
