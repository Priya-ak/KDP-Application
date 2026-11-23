import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../app.ts";
import type { AppContext } from "../context.ts";
import { conflict } from "../errors.ts";
import { parseBody } from "../services/accounts.ts";
import { processPageArtwork } from "../services/artwork.ts";
import {
  addPage,
  bumpGeneration,
  deletePage,
  duplicatePage,
  getPage,
  getProject,
  pageDto,
  refreshProjectStatus,
  reorderPages,
  restoreStoryOrder,
  savePageVersion,
  setPageReview,
  undoPage,
  updatePage,
  updatePageSchema,
} from "../services/projects.ts";
import { assertImageQuota } from "../services/usage.ts";
import { enqueue } from "../workflow/queue.ts";
import { jobDto, readImageUpload } from "./projects.ts";

export async function registerPageRoutes(server: FastifyInstance, app: AppContext) {
  type P = { id: string; pid: string };

  server.post("/api/projects/:id/pages", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ afterPosition: z.number().int().min(0).optional(), sceneTitle: z.string().max(200).optional(), sceneDescription: z.string().max(2000).optional(), storyText: z.string().max(2000).optional() }), req.body);
    return reply.status(201).send({ page: pageDto(await addPage(app, requireUser(req).id, id, body)) });
  });

  server.put("/api/projects/:id/pages/order", async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ ids: z.array(z.string()).max(200) }), req.body);
    const r = await reorderPages(app, requireUser(req).id, id, body.ids);
    return { pages: r.pages.map(pageDto), warning: r.warning };
  });

  server.post("/api/projects/:id/pages/restore-order", async (req) => {
    const { id } = req.params as { id: string };
    const r = await restoreStoryOrder(app, requireUser(req).id, id);
    return { pages: r.pages.map(pageDto), warning: r.warning };
  });

  server.patch("/api/projects/:id/pages/:pid", async (req) => {
    const { id, pid } = req.params as P;
    return { page: pageDto(await updatePage(app, requireUser(req).id, id, pid, parseBody(updatePageSchema, req.body))) };
  });

  server.delete("/api/projects/:id/pages/:pid", async (req) => {
    const { id, pid } = req.params as P;
    await deletePage(app, requireUser(req).id, id, pid);
    return { ok: true };
  });

  server.post("/api/projects/:id/pages/:pid/duplicate", async (req, reply) => {
    const { id, pid } = req.params as P;
    return reply.status(201).send({ page: pageDto(await duplicatePage(app, requireUser(req).id, id, pid)) });
  });

  server.post("/api/projects/:id/pages/:pid/undo", async (req) => {
    const { id, pid } = req.params as P;
    return { page: pageDto(await undoPage(app, requireUser(req).id, id, pid)) };
  });

  server.post("/api/projects/:id/pages/:pid/review", async (req) => {
    const { id, pid } = req.params as P;
    const { action } = parseBody(z.object({ action: z.enum(["approve", "reject", "unlock"]) }), req.body);
    const page = await setPageReview(app, requireUser(req).id, id, pid, action);
    return { page: pageDto(page) };
  });

  /** Regenerate one page. Each request bumps the generation number, which is also the job's idempotency key. */
  server.post("/api/projects/:id/pages/:pid/generate", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id, pid } = req.params as P;
    await getProject(app, user.id, id);
    const existing = await getPage(app, user.id, id, pid);
    if (existing.status === "queued" || existing.status === "generating") throw conflict("This page is already being generated.");
    await assertImageQuota(app, user.id, 1);
    const { page, job } = await app.db.transaction(async (tx) => {
      const page = await bumpGeneration(app, user.id, id, pid, tx);
      const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "generate_page", payload: { projectId: id, pageId: pid, generation: page.generation_count }, idempotencyKey: `gen:${pid}:${page.generation_count}`, maxAttempts: 4 }, tx);
      return { page, job };
    });
    return reply.status(202).send({ page: pageDto(page), job: jobDto(job) });
  });

  /** Replace a page's artwork with an uploaded image. */
  server.post("/api/projects/:id/pages/:pid/image", async (req) => {
    const user = requireUser(req);
    const { id, pid } = req.params as P;
    const project = await getProject(app, user.id, id);
    const page = await getPage(app, user.id, id, pid);
    if (page.locked) throw conflict("This page is approved and locked. Unlock it to replace the image.");
    const bytes = await readImageUpload(req, app);
    const processed = await processPageArtwork(app, project, page, bytes, { provider: "upload", isDemo: false, kind: "upload", meta: { uploaded: true } });
    await app.db.transaction(async (tx) => {
      await savePageVersion(tx, page, "replace image");
      await tx.query("UPDATE pages SET asset_id = $2, status = $3, quality = $4, last_error = NULL, generation_count = generation_count + 1, updated_at = now() WHERE id = $1", [pid, processed.asset.id, processed.status, processed.quality]);
    });
    await refreshProjectStatus(app, id);
    return { page: pageDto(await getPage(app, user.id, id, pid)) };
  });
}
