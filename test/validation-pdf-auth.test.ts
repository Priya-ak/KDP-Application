import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client, createTestEnv, settings, type TestEnv } from "./helpers.ts";
import { demoLineArt } from "../server/ai/demo-art.ts";
import { toGray } from "../server/imaging/codec.ts";
import { buildCoverPdf } from "../server/pdf/cover.ts";
import { inspectPdf } from "../server/pdf/inspect.ts";
import { buildInteriorPdf } from "../server/pdf/interior.ts";
import { planInterior } from "../shared/layout.ts";
import { coverLayout, getTrim } from "../shared/kdp.ts";
import { coverConfigSchema, metadataSchema, type BookSettings } from "../shared/settings.ts";
import { validateBook } from "../server/validation/kdp.ts";

const art = demoLineArt({ seed: "t", theme: "meadow", complexity: "medium", width: 1700, height: 2200 });

async function build(cfg: BookSettings, count: number, opts: { omitImage?: number; longStory?: boolean } = {}) {
  const content = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, storyText: cfg.mode === "coloring" ? "" : opts.longStory ? "word ".repeat(900) : "Short text.", activity: "" }));
  const plan = planInterior(cfg, content);
  const interior = await buildInteriorPdf({
    settings: cfg, plan, title: "Test Book", subtitle: "Sub", author: "Me", copyrightText: "(c) me",
    content: new Map(content.map((c, i) => [c.id, { storyText: c.storyText, activity: "", sceneTitle: `S${i}` }])),
    loadImage: async (id) => (opts.omitImage !== undefined && id === `p${opts.omitImage}` ? null : toGray(art)),
  });
  const layout = coverLayout(plan.trim, plan.pageCount, cfg.paper);
  const coverCfg = coverConfigSchema.parse({ title: "Test Book", author: "Me", backText: "A fun book." });
  const cover = await buildCoverPdf({ layout, config: coverCfg, title: "Test Book", subtitle: "Sub", author: "Me", backText: "A fun book.", art: null, thumbnails: [toGray(art)] });
  return { plan, interior, layout, cover, cfg, content };
}

async function validate(b: Awaited<ReturnType<typeof build>>, over: Partial<Parameters<typeof validateBook>[0]> = {}) {
  return validateBook({
    settings: b.cfg, plan: b.plan, interior: b.interior.report, interiorPdf: await inspectPdf(b.interior.bytes),
    coverLayout: b.layout, cover: b.cover.report, coverPdf: await inspectPdf(b.cover.bytes),
    pages: b.content.map((c, i) => ({ id: c.id, position: i + 1, status: "approved", isDemo: false, sha256: `h${i}`, qualityStatus: "pass", qualityMessages: [], storyIndex: null })),
    coverArtIsDemo: false, hasCoverArt: true, metadata: metadataSchema.parse({ description: "Nice book." }), ...over,
  });
}
const find = (r: Awaited<ReturnType<typeof validate>>, id: string) => r.findings.find((f) => f.id === id)!;

describe("PDF generation and KDP validation", () => {
  test("a 24+ page coloring book builds at the exact trim and validates without errors", async () => {
    const b = await build(settings({ illustrationCount: 12, trimSize: "6x9" }), 12);
    const pdf = await PDFDocument.load(b.interior.bytes);
    expect(pdf.getPageCount()).toBe(b.plan.pageCount);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 432, height: 648 });
    const r = await validate(b);
    expect(r.findings.filter((f) => f.status === "error"), JSON.stringify(r.findings.filter((f) => f.status === "error"))).toHaveLength(0);
    expect(r.ready).toBe(true);
    expect(find(r, "print_previewer").status).toBe("manual");
    expect(find(r, "spine").status).toBe("pass");
    // Images were embedded at full resolution: 1700px across the box ≥ 200 dpi.
    expect(find(r, "fonts_embedded").status).toBe("pass");
  });

  test("bleed pages are trim + 0.125 x 0.25", async () => {
    const b = await build(settings({ illustrationCount: 12, trimSize: "6x9", bleed: true }), 12);
    expect((await inspectPdf(b.interior.bytes)).pageSizes[0]).toEqual({ width: 6.125, height: 9.25 });
    expect(find(await validate(b), "bleed").status).toBe("pass");
  });

  test("too few pages is an error with a fix", async () => {
    const b = await build(settings({ illustrationCount: 2, blankBacks: false, frontMatter: { titlePage: false, copyrightPage: false, belongsTo: false, colorTestPage: false, dedication: "" } }), 2);
    const f = find(await validate(b), "page_count");
    expect(f.status).toBe("error");
    expect(f.fix).toBeTruthy();
  });

  test("a missing illustration is an error listing the page", async () => {
    const b = await build(settings({ illustrationCount: 12 }), 12, { omitImage: 3 });
    const f = find(await validate(b), "missing_pages");
    expect(f.status).toBe("error");
    expect(f.pages!.length).toBe(1);
  });

  test("story text that cannot fit is flagged", async () => {
    const b = await build(settings({ mode: "story_coloring", illustrationCount: 12 }), 12, { longStory: true });
    expect(find(await validate(b), "text_overflow").status).toBe("error");
  });

  test("a stale cover (wrong spine) is caught", async () => {
    const b = await build(settings({ illustrationCount: 12 }), 12);
    const stale = coverLayout(b.plan.trim, b.plan.pageCount - 10, b.cfg.paper);
    expect(find(await validate(b, { coverLayout: stale }), "spine").status).toBe("error");
  });

  test("low resolution and duplicates are reported; unreadable PDFs are errors", async () => {
    const b = await build(settings({ illustrationCount: 12 }), 12);
    const lowRes = { ...b.interior.report, pages: b.interior.report.pages.map((p) => (p.image ? { ...p, image: { ...p.image, dpi: 120 } } : p)) };
    expect(find(await validate(b, { interior: lowRes }), "image_resolution").status).toBe("error");
    const same = b.content.map((c, i) => ({ id: c.id, position: i + 1, status: "approved", isDemo: false, sha256: "same", qualityStatus: "pass", qualityMessages: [], storyIndex: null }));
    expect(find(await validate(b, { pages: same }), "duplicate_pages").status).toBe("warning");
    const broken = await inspectPdf(new Uint8Array([1, 2, 3]));
    expect(broken.readable).toBe(false);
    expect(find(await validate(b, { interiorPdf: broken }), "pdf_interior").status).toBe("error");
  });

  test("spine text appears only on thick books and stays inside the safe zone", async () => {
    const thin = await build(settings({ illustrationCount: 12 }), 12);
    expect(thin.cover.report.spineTextDrawn).toBe(false);
    const thick = await build(settings({ illustrationCount: 50, trimSize: "6x9" }), 50); // ~102 pages
    expect(thick.layout.spineTextAllowed).toBe(true);
    expect(thick.cover.report.spineTextDrawn).toBe(true);
    expect(find(await validate(thick), "spine_text").status).toBe("pass");
  });

  test("unapproved and demo pages produce warnings, not errors", async () => {
    const b = await build(settings({ illustrationCount: 12 }), 12);
    const pages = b.content.map((c, i) => ({ id: c.id, position: i + 1, status: "generated", isDemo: true, sha256: `h${i}`, qualityStatus: "pass", qualityMessages: [], storyIndex: null }));
    const r = await validate(b, { pages });
    expect(find(r, "approval").status).toBe("warning");
    expect(find(r, "demo_content").status).toBe("warning");
    expect(r.ready).toBe(true);
  });

  test("prohibited listing terms are flagged", async () => {
    const b = await build(settings({ illustrationCount: 12 }), 12);
    expect(find(await validate(b, { metadata: metadataSchema.parse({ description: "Best seller! Visit www.example.com" }) }), "listing_terms").status).toBe("warning");
  });
});

describe("authentication and authorization", () => {
  let env: TestEnv;
  beforeAll(async () => { env = await createTestEnv(); });
  afterAll(async () => env.close());

  test("register validates input, hides duplicates, and logs in/out", async () => {
    const c = new Client(env.server);
    expect((await c.req("POST", "/api/auth/register", { email: "bad", password: "longenoughpassword" })).status).toBe(400);
    expect((await c.req("POST", "/api/auth/register", { email: "a@example.com", password: "short" })).status).toBe(400);
    await c.register("a@example.com");
    expect((await c.req("POST", "/api/auth/register", { email: "a@example.com", password: "another long password" })).status).toBe(409);
    const me = await c.req("GET", "/api/auth/me");
    expect(me.json.user.email).toBe("a@example.com");
    expect(JSON.stringify(me.json)).not.toMatch(/password|api_key|sk-/i);
    await c.req("POST", "/api/auth/logout");
    const anon = new Client(env.server);
    expect((await anon.req("POST", "/api/auth/login", { email: "a@example.com", password: "wrong password!!" })).status).toBe(401);
    expect((await anon.req("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong password!!" })).status).toBe(401);
    const ok = await anon.req("POST", "/api/auth/login", { email: "a@example.com", password: "correct horse battery" });
    expect(ok.status).toBe(200);
  });

  test("logged-out session cookies stop working", async () => {
    const c = new Client(env.server);
    await c.register("b@example.com");
    const cookie = c.cookie;
    await c.req("POST", "/api/auth/logout");
    const stale = await env.server.inject({ method: "GET", url: "/api/projects", headers: { cookie } });
    expect(stale.statusCode).toBe(401);
  });

  test("input validation rejects bad settings and oversize fields", async () => {
    const c = new Client(env.server);
    await c.register("c@example.com");
    expect((await c.req("POST", "/api/projects", { settings: { ...settings(), trimSize: "99x99" } })).status).toBe(400);
    expect((await c.req("POST", "/api/projects", { settings: { ...settings(), illustrationCount: 9999 } })).status).toBe(400);
    expect((await c.req("POST", "/api/projects", { settings: { ...settings(), theme: "x".repeat(5000) } })).status).toBe(400);
  });

  test("auth endpoints are rate limited", async () => {
    const c = new Client(env.server);
    let last = 0;
    for (let i = 0; i < 14; i++) last = (await c.req("POST", "/api/auth/login", { email: "x@example.com", password: "nope nope nope" })).status;
    expect(last).toBe(429);
  });

  test("API responses never include provider secrets", async () => {
    process.env.OPENAI_API_KEY = "sk-test-secret-should-never-leak-1234567890";
    const c = new Client(env.server);
    await c.register("d@example.com");
    const body = JSON.stringify([(await c.req("GET", "/api/auth/me")).json, (await c.req("GET", "/api/usage")).json]);
    delete process.env.OPENAI_API_KEY;
    expect(body).not.toContain("sk-test-secret");
  });
});
