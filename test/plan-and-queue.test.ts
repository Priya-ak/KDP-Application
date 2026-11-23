import { afterEach, describe, expect, test } from "vitest";
import { DemoImageProvider, type ImageProvider } from "../server/ai/image.ts";
import { DemoTextProvider } from "../server/ai/text.ts";
import { slugKey, validatePlan, type BookPlan } from "../server/ai/schemas.ts";
import { buildIllustrationPrompt } from "../server/ai/prompts.ts";
import { JobError } from "../server/errors.ts";
import { analyzeLineArt, prepareLineArt } from "../server/imaging/lineart.ts";
import { Canvas } from "../server/imaging/raster.ts";
import { backoffMs, enqueue } from "../server/workflow/queue.ts";
import { Client, createTestEnv, settings, type TestEnv } from "./helpers.ts";

const goodPlan = (n: number): BookPlan => ({
  title: "Milo and the Moon",
  subtitle: "A Coloring Story",
  synopsis: "Milo visits the moon.",
  tone: "playful",
  outline: ["start", "end"],
  characters: [{ key: "Milo Rabbit", name: "Milo", role: "hero", description: "curious", visual_traits: "a small round rabbit with long ears and a scarf" }],
  pages: Array.from({ length: n }, (_, i) => ({ page_number: i + 1, scene_title: `Scene ${i + 1}`, story_text: "Milo hops along.", scene_description: `Milo explores crater number ${i + 1} under a big sky`, characters: ["milo_rabbit"], activity: "" })),
});

describe("plan validation", () => {
  const s = settings({ mode: "story_coloring", illustrationCount: 4 });

  test("accepts a good plan and normalizes character keys and page numbers", () => {
    const { plan, issues } = validatePlan(goodPlan(4), s);
    expect(plan.characters[0]!.key).toBe("milo_rabbit");
    expect(plan.pages.map((p) => p.page_number)).toEqual([1, 2, 3, 4]);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  test("rejects malformed output and plans that are too short", () => {
    expect(() => validatePlan({ title: "x" }, s)).toThrow(/structure/);
    expect(() => validatePlan(goodPlan(2), s)).toThrow(/requested/);
  });

  test("trims extra pages", () => {
    expect(validatePlan(goodPlan(7), s).plan.pages).toHaveLength(4);
  });

  test("flags repetitive scenes, unknown characters and text-in-image requests", () => {
    const p = goodPlan(4);
    p.pages[1]!.scene_description = p.pages[0]!.scene_description;
    p.pages[1]!.scene_title = p.pages[0]!.scene_title;
    p.pages[2]!.characters = ["ghost"];
    p.pages[3]!.scene_description = "A sign that says WELCOME above the door";
    const { plan, issues } = validatePlan(p, s);
    expect(issues.some((i) => /similar/.test(i.message) && i.page === 2)).toBe(true);
    expect(plan.pages[2]!.characters).toEqual([]);
    expect(issues.some((i) => /text inside/.test(i.message) && i.page === 4)).toBe(true);
  });

  test("flags age-inappropriate content for children", () => {
    const p = goodPlan(4);
    p.pages[0]!.story_text = "The dragon kills the knight with a knife.";
    expect(validatePlan(p, settings({ ...s, audience: "preschool" })).issues.some((i) => i.severity === "error")).toBe(true);
    expect(validatePlan(p, settings({ ...s, audience: "adult" })).issues.some((i) => i.severity === "error")).toBe(false);
  });

  test("coloring-only mode strips story text", () => {
    expect(validatePlan(goodPlan(4), settings({ mode: "coloring", illustrationCount: 4 })).plan.pages.every((p) => p.story_text === "")).toBe(true);
  });

  test("demo writer output passes validation for every length", async () => {
    for (const n of [1, 12, 30]) {
      const cfg = settings({ illustrationCount: n, mode: "story_coloring" });
      const r = await new DemoTextProvider().planBook(cfg);
      expect(() => validatePlan(r.data, cfg)).not.toThrow();
    }
  });

  test("slugKey", () => expect(slugKey("  Milo the Rabbit!! ")).toBe("milo_the_rabbit"));
});

describe("character consistency in prompts", () => {
  test("the same character description and line-art rules appear on every page", () => {
    const chars = [{ key: "milo", name: "Milo", visual_traits: "a small round rabbit with a striped scarf" }];
    const cfg = settings();
    const a = buildIllustrationPrompt({ scene_description: "Milo eats lunch", characters: ["milo"] }, chars, cfg);
    const b = buildIllustrationPrompt({ scene_description: "Milo flies a kite", characters: ["milo"] }, chars, cfg);
    for (const p of [a, b]) {
      expect(p).toContain("a small round rabbit with a striped scarf");
      expect(p).toMatch(/No text, letters/);
      expect(p).toMatch(/white background/);
    }
    expect(buildIllustrationPrompt({ scene_description: "Empty meadow", characters: [] }, chars, cfg)).not.toContain("Milo:");
  });
});

describe("line-art quality checks", () => {
  test("blank, shaded and solid-black images are caught", () => {
    expect(analyzeLineArt(new Canvas(400, 500, 1, 255).toRaster()).status).toBe("error");
    const gray = new Canvas(400, 500, 1, 255);
    gray.fillRect(50, 50, 300, 400, 150);
    expect(analyzeLineArt(gray.toRaster()).checks.find((c) => c.id === "shading")!.status).toBe("warning");
    const black = new Canvas(400, 500, 1, 255);
    black.fillRect(50, 50, 300, 400, 0);
    expect(analyzeLineArt(black.toRaster()).checks.find((c) => c.id === "solid_black")!.status).toBe("warning");
    const good = new Canvas(400, 500, 1, 255);
    good.ellipse(200, 250, 120, 160, 6);
    expect(analyzeLineArt(good.toRaster()).status).toBe("pass");
  });

  test("print preparation upscales to the target DPI and thresholds gray", () => {
    const c = new Canvas(600, 800, 1, 255);
    c.ellipse(300, 400, 200, 300, 8, 255, 0, 120);
    const { raster, upscale } = prepareLineArt(c.toRaster(), { boxWidthIn: 7.5, boxHeightIn: 10, targetDpi: 300, threshold: true });
    expect(upscale).toBeGreaterThan(2);
    expect(raster.width / 7.5).toBeGreaterThanOrEqual(300);
    expect(new Set(Array.from(raster.data)).size).toBeLessThanOrEqual(2);
  });
});

describe("job queue", () => {
  let env: TestEnv | undefined;
  afterEach(async () => env?.close());

  test("backoff grows exponentially, is capped, and honors Retry-After", () => {
    const base = (n: number) => backoffMs(n);
    expect(base(1)).toBeLessThan(1300);
    expect(base(3)).toBeGreaterThan(3000);
    expect(base(10)).toBeLessThanOrEqual(72_000);
    expect(backoffMs(1, 5000)).toBe(5000);
  });

  test("idempotency key returns the existing job", async () => {
    env = await createTestEnv();
    const c = new Client(env.server);
    const u = await c.register("q@example.com");
    const a = await enqueue(env.app, { userId: u.id, projectId: null, type: "noop", payload: {}, idempotencyKey: "k1" });
    const b = await enqueue(env.app, { userId: u.id, projectId: null, type: "noop", payload: {}, idempotencyKey: "k1" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  test("transient provider failures retry with bounded attempts, then mark the page failed", async () => {
    let calls = 0;
    const flaky: ImageProvider = { name: "flaky", model: "m", isDemo: false, supportsReferences: false, async generateIllustration() { calls++; throw new JobError("transient", "provider down"); } };
    env = await createTestEnv({ image: flaky });
    const c = new Client(env.server);
    await c.register("r@example.com");
    const p = (await c.req("POST", "/api/projects", { settings: settings({ illustrationCount: 1 }) })).json.project;
    await c.req("POST", `/api/projects/${p.id}/plan`, {});
    await env.drain();
    await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing", confirm: true });
    // Pull retries forward instead of waiting for backoff.
    for (let i = 0; i < 6; i++) {
      await env.app.db.query("UPDATE jobs SET run_after = now() WHERE status = 'queued'");
      await env.drain();
    }
    const d = (await c.req("GET", `/api/projects/${p.id}`)).json;
    expect(calls).toBe(4); // maxAttempts for page jobs
    expect(d.pages[0].status).toBe("failed");
    expect(d.pages[0].lastError).toMatch(/provider down/);
    const job = d.jobs.find((j: any) => j.type === "generate_page");
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(4);
    // The user can retry a failed page.
    expect((await c.req("POST", `/api/projects/${p.id}/pages/${d.pages[0].id}/generate`)).status).toBe(202);
  });

  test("permanent failures do not retry; a retry succeeds without duplicating work", async () => {
    let mode: "fail" | "ok" = "fail";
    let calls = 0;
    const demo = new DemoImageProvider(0.25);
    const provider: ImageProvider = {
      name: "p", model: "m", isDemo: false, supportsReferences: false,
      async generateIllustration(i, s) { calls++; if (mode === "fail") throw new JobError("content_policy", "blocked"); return demo.generateIllustration(i); },
    };
    env = await createTestEnv({ image: provider });
    const c = new Client(env.server);
    await c.register("s@example.com");
    const p = (await c.req("POST", "/api/projects", { settings: settings({ illustrationCount: 2 }) })).json.project;
    await c.req("POST", `/api/projects/${p.id}/plan`, {});
    await env.drain();
    await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing", confirm: true });
    await env.drain();
    expect(calls).toBe(2);
    let d = (await c.req("GET", `/api/projects/${p.id}`)).json;
    expect(d.pages.every((x: any) => x.status === "failed")).toBe(true);
    mode = "ok";
    await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing", confirm: true });
    await env.drain();
    d = (await c.req("GET", `/api/projects/${p.id}`)).json;
    expect(d.pages.every((x: any) => x.asset)).toBe(true);
    // Successful pages are never regenerated by a "missing" batch.
    await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing", confirm: true });
    await env.drain();
    expect(calls).toBe(4);
  });

  test("cancelling a queued job stops it", async () => {
    env = await createTestEnv();
    const c = new Client(env.server);
    await c.register("t@example.com");
    const p = (await c.req("POST", "/api/projects", { settings: settings({ illustrationCount: 1 }) })).json.project;
    const r = await c.req("POST", `/api/projects/${p.id}/plan`, {});
    expect((await c.req("POST", `/api/jobs/${r.json.job.id}/cancel`)).json.job.status).toBe("cancelled");
    expect(await env.drain()).toBe(0);
  });

  test("large batches require confirmation and quotas are enforced", async () => {
    const paid: ImageProvider = { name: "paid", model: "m", isDemo: false, supportsReferences: false, async generateIllustration(i) { return new DemoImageProvider(0.25).generateIllustration(i); } };
    env = await createTestEnv({ image: paid, config: { limits: { monthlyImageQuota: 3, monthlyTextQuota: 50, batchConfirmUsd: 0.05, batchConfirmImages: 40, maxUploadBytes: 5_000_000, maxProjectsPerUser: 10 } } as any });
    const c = new Client(env.server);
    await c.register("u@example.com");
    const p = (await c.req("POST", "/api/projects", { settings: settings({ illustrationCount: 6 }) })).json.project;
    await c.req("POST", `/api/projects/${p.id}/plan`, {});
    await env.drain();
    const est = await c.req("POST", `/api/projects/${p.id}/estimate`, { scope: "missing" });
    expect(est.json.estimate.images).toBe(6);
    const needs = await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing" });
    expect(needs.status).toBe(409);
    expect(needs.json.error.code).toBe("confirmation_required");
    const over = await c.req("POST", `/api/projects/${p.id}/generate`, { scope: "missing", confirm: true });
    expect(over.status).toBe(429);
    expect(over.json.error.code).toBe("quota_exceeded");
  });
});
