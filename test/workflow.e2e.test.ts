import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client, createTestEnv, multipartBody, settings, type TestEnv } from "./helpers.ts";
import { Canvas } from "../server/imaging/raster.ts";
import { encodePng } from "../server/imaging/codec.ts";

/**
 * End-to-end through the HTTP API with the DEMO (mocked) text and image
 * providers: create → plan → illustrate → review/reorder → cover → metadata →
 * export → validate → download. No live AI provider is called.
 */
describe("book creation workflow (demo providers)", () => {
  let env: TestEnv;
  let c: Client;
  let projectId = "";

  beforeAll(async () => {
    env = await createTestEnv();
    c = new Client(env.server);
    await c.register("author@example.com");
  });
  afterAll(async () => env?.close());

  test("creates a book project", async () => {
    const r = await c.req("POST", "/api/projects", { title: "", author: "Jane Doe", settings: settings({ theme: "friendly dinosaurs at a picnic", mode: "story_coloring", illustrationCount: 12 }) });
    expect(r.status).toBe(201);
    projectId = r.json.project.id;
    expect(r.json.project.status).toBe("draft");
    const list = await c.req("GET", "/api/projects");
    expect(list.json.projects).toHaveLength(1);
  });

  test("plans the story, characters and pages", async () => {
    const r = await c.req("POST", `/api/projects/${projectId}/plan`, {});
    expect(r.status).toBe(202);
    await env.drain();
    const d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    expect(d.project.status).toBe("planned");
    expect(d.project.title.length).toBeGreaterThan(3);
    expect(d.pages).toHaveLength(12);
    expect(d.characters.length).toBeGreaterThanOrEqual(1);
    expect(d.pages[0].storyText.length).toBeGreaterThan(0);
    expect(d.pages[0].illustrationPrompt).toMatch(/No text, letters/);
    expect(d.pages[0].illustrationPrompt).toContain(d.characters[0].visualTraits);
    // Re-planning without confirmation is refused.
    expect((await c.req("POST", `/api/projects/${projectId}/plan`, {})).status).toBe(409);
  });

  test("generates every page once, idempotently", async () => {
    const r = await c.req("POST", `/api/projects/${projectId}/generate`, { scope: "missing" });
    expect(r.status).toBe(202);
    expect(r.json.jobs).toHaveLength(12);
    // A repeated request while jobs are queued doesn't create duplicates.
    const again = await c.req("POST", `/api/projects/${projectId}/generate`, { scope: "missing" });
    expect(again.json.jobs).toHaveLength(0);
    await env.drain();
    const d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    expect(d.pages.every((p: any) => p.asset && p.asset.isDemo)).toBe(true);
    expect(d.pages.every((p: any) => ["generated", "needs_review"].includes(p.status))).toBe(true);
    expect(d.project.status).toBe("review");
    // After success nothing is "missing" any more.
    const none = await c.req("POST", `/api/projects/${projectId}/generate`, { scope: "missing" });
    expect(none.json.jobs).toHaveLength(0);
    const imageUsage = (await c.req("GET", "/api/usage")).json;
    expect(imageUsage.images).toBe(12);
  });

  test("edits, undoes, regenerates, reorders and restores pages", async () => {
    let d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    const first = d.pages[0];
    const edited = await c.req("PATCH", `/api/projects/${projectId}/pages/${first.id}`, { storyText: "A brand new sentence." });
    expect(edited.json.page.storyText).toBe("A brand new sentence.");
    const undone = await c.req("POST", `/api/projects/${projectId}/pages/${first.id}/undo`);
    expect(undone.json.page.storyText).toBe(first.storyText);

    const regen = await c.req("POST", `/api/projects/${projectId}/pages/${first.id}/generate`);
    expect(regen.status).toBe(202);
    expect((await c.req("POST", `/api/projects/${projectId}/pages/${first.id}/generate`)).status).toBe(409);
    await env.drain();
    d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    expect(d.pages[0].asset.id).not.toBe(first.asset.id);
    expect(d.pages[0].generationCount).toBe(first.generationCount + 1);

    const ids = d.pages.map((p: any) => p.id);
    const reversed = [...ids].reverse();
    const ro = await c.req("PUT", `/api/projects/${projectId}/pages/order`, { ids: reversed });
    expect(ro.json.pages.map((p: any) => p.id)).toEqual(reversed);
    expect(ro.json.warning).toMatch(/story/i);
    // A stale or partial list is rejected.
    expect((await c.req("PUT", `/api/projects/${projectId}/pages/order`, { ids: reversed.slice(1) })).status).toBe(409);
    const restored = await c.req("POST", `/api/projects/${projectId}/pages/restore-order`);
    expect(restored.json.pages.map((p: any) => p.id)).toEqual(ids);

    const dup = await c.req("POST", `/api/projects/${projectId}/pages/${ids[1]}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.json.page.position).toBe(3);
    expect((await c.req("DELETE", `/api/projects/${projectId}/pages/${dup.json.page.id}`)).status).toBe(200);
    d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    expect(d.pages.map((p: any) => p.position)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  test("replaces a page image with an upload and validates the file", async () => {
    const d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    const page = d.pages[2];
    const canvas = new Canvas(900, 1200, 1, 255);
    canvas.ellipse(450, 600, 300, 380, 12);
    const { payload, contentType } = multipartBody("art.png", encodePng(canvas.toRaster()), "image/png");
    const ok = await env.server.inject({ method: "POST", url: `/api/projects/${projectId}/pages/${page.id}/image`, payload, headers: { cookie: c.cookie, "x-csrf-token": c.csrf, "content-type": contentType } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().page.asset.provider).toBe("upload");
    expect(ok.json().page.asset.isDemo).toBe(false);
    const bad = multipartBody("evil.png", Buffer.from("<script>alert(1)</script>"), "image/png");
    const rejected = await env.server.inject({ method: "POST", url: `/api/projects/${projectId}/pages/${page.id}/image`, payload: bad.payload, headers: { cookie: c.cookie, "x-csrf-token": c.csrf, "content-type": bad.contentType } });
    expect(rejected.statusCode).toBe(400);
  });

  test("approves and locks pages", async () => {
    const d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    for (const p of d.pages) expect((await c.req("POST", `/api/projects/${projectId}/pages/${p.id}/review`, { action: "approve" })).json.page.locked).toBe(true);
    const locked = d.pages[0];
    expect((await c.req("PATCH", `/api/projects/${projectId}/pages/${locked.id}`, { storyText: "nope" })).status).toBe(409);
    expect((await c.req("DELETE", `/api/projects/${projectId}/pages/${locked.id}`)).status).toBe(409);
  });

  test("generates cover art, metadata, and exports print files that pass validation", async () => {
    expect((await c.req("POST", `/api/projects/${projectId}/cover/art`, {})).status).toBe(202);
    expect((await c.req("POST", `/api/projects/${projectId}/metadata/generate`)).status).toBe(202);
    await env.drain();
    let d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    expect(d.project.coverArtAssetId).toBeTruthy();
    expect(d.project.metadata.keywords).toHaveLength(7);
    expect(d.project.metadataApproved).toBe(false);
    await c.req("PATCH", `/api/projects/${projectId}`, { metadataApproved: true, cover: { backText: "Twelve dinosaur scenes to color." } });

    const ex = await c.req("POST", `/api/projects/${projectId}/exports`, { includeImages: true });
    expect(ex.status).toBe(202);
    await env.drain();
    d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    const exp = d.latestExport;
    const errors = exp.report?.findings.filter((f: any) => f.status === "error") ?? [];
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
    expect(exp.status).toBe("ready_for_review");
    expect(exp.report.findings.find((f: any) => f.id === "demo_content").status).toBe("warning");
    expect(exp.report.findings.find((f: any) => f.id === "print_previewer").status).toBe("manual");
    expect(d.project.status).toBe("exported");

    // Interior: 3 front-matter pages + blank + 12 × (page + blank back) = 28 pages at 8.5 × 11.
    const interior = await c.req("GET", `/api/assets/${exp.interiorAssetId}?download=1`);
    expect(interior.headers["content-type"]).toBe("application/pdf");
    const pdf = await PDFDocument.load(interior.raw);
    expect(pdf.getPageCount()).toBe(28);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    const cover = await PDFDocument.load((await c.req("GET", `/api/assets/${exp.coverAssetId}`)).raw);
    // 0.125 + 8.5 + 28 × 0.002252 + 8.5 + 0.125 = 17.3131 in
    expect(cover.getPage(0).getWidth() / 72).toBeCloseTo(17.3131, 3);
    const zip = unzipSync(new Uint8Array((await c.req("GET", `/api/assets/${exp.packageAssetId}`)).raw));
    const names = Object.keys(zip);
    expect(names.some((n) => n.endsWith("-interior.pdf"))).toBe(true);
    expect(names.some((n) => n.endsWith("-cover.pdf"))).toBe(true);
    expect(names).toContain("validation/report.json");
    expect(names).toContain("listing/listing.txt");
    expect(names.filter((n) => n.startsWith("images/"))).toHaveLength(12);
  });

  test("isolates users' projects and files", async () => {
    const d = (await c.req("GET", `/api/projects/${projectId}`)).json;
    const other = new Client(env.server);
    await other.register("someone-else@example.com");
    expect((await other.req("GET", `/api/projects/${projectId}`)).status).toBe(404);
    expect((await other.req("GET", `/api/assets/${d.pages[0].asset.id}`)).status).toBe(404);
    expect((await other.req("PATCH", `/api/projects/${projectId}`, { title: "hijack" })).status).toBe(404);
    expect((await other.req("GET", "/api/projects")).json.projects).toHaveLength(0);
    const anon = new Client(env.server);
    expect((await anon.req("GET", "/api/projects")).status).toBe(401);
  });

  test("rejects state-changing requests without the CSRF token", async () => {
    const r = await env.server.inject({ method: "PATCH", url: `/api/projects/${projectId}`, payload: { title: "x" }, headers: { cookie: c.cookie } });
    expect(r.statusCode).toBe(403);
  });

  test("deletes a project with its files", async () => {
    expect((await c.req("DELETE", `/api/projects/${projectId}`)).status).toBe(200);
    expect((await c.req("GET", `/api/projects/${projectId}`)).status).toBe(404);
  });
});
