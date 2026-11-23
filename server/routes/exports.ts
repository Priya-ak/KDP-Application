import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../app.ts";
import type { AppContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { randomId } from "../security/crypto.ts";
import { parseBody } from "../services/accounts.ts";
import { getOwnedAsset, readAsset } from "../services/assets.ts";
import { getProject, listPages } from "../services/projects.ts";
import { enqueue } from "../workflow/queue.ts";
import { exportDto, jobDto } from "./projects.ts";

export async function registerExportRoutes(server: FastifyInstance, app: AppContext) {
  server.post("/api/projects/:id/exports", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ includeImages: z.boolean().default(false) }), req.body);
    await getProject(app, user.id, id);
    if (!(await listPages(app, id)).length) throw conflict("Generate the book's pages before exporting.");
    const running = await app.db.one("SELECT id FROM exports WHERE project_id = $1 AND status IN ('queued', 'building')", [id]);
    if (running) throw conflict("An export is already in progress for this book.");
    const exportId = randomId("exp");
    const job = await app.db.transaction(async (tx) => {
      await tx.query("INSERT INTO exports (id, project_id, user_id, include_images) VALUES ($1, $2, $3, $4)", [exportId, id, user.id, body.includeImages]);
      const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "export_book", payload: { projectId: id, exportId }, idempotencyKey: `export:${exportId}`, maxAttempts: 2 }, tx);
      await tx.query("UPDATE exports SET job_id = $2 WHERE id = $1", [exportId, job.id]);
      return job;
    });
    const row = await app.db.one<Record<string, unknown>>("SELECT * FROM exports WHERE id = $1", [exportId]);
    return reply.status(202).send({ export: exportDto(row!), job: jobDto(job) });
  });

  server.get("/api/projects/:id/exports", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await getProject(app, user.id, id);
    const rows = await app.db.query<Record<string, unknown>>("SELECT * FROM exports WHERE project_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 30", [id, user.id]);
    return { exports: rows.map(exportDto) };
  });

  server.get("/api/exports/:eid", async (req) => {
    const user = requireUser(req);
    const { eid } = req.params as { eid: string };
    const row = await app.db.one<Record<string, unknown>>("SELECT * FROM exports WHERE id = $1 AND user_id = $2", [eid, user.id]);
    if (!row) throw notFound("Export");
    return { export: exportDto(row) };
  });

  /** Authenticated asset download: only the owner can read an asset. */
  server.get("/api/assets/:aid", async (req, reply) => {
    const user = requireUser(req);
    const { aid } = req.params as { aid: string };
    const q = req.query as { variant?: string; download?: string };
    const asset = await getOwnedAsset(app, user.id, aid);
    const variant = q.variant === "thumb" ? "thumb" : "full";
    const body = await readAsset(app, asset, variant);
    const filename = String((asset.meta as { filename?: string }).filename ?? `${asset.id}.${asset.mime.split("/")[1] === "jpeg" ? "jpg" : asset.mime.split("/")[1]}`).replace(/[^A-Za-z0-9._-]/g, "_");
    reply.header("content-type", variant === "thumb" && asset.mime.startsWith("image/") ? "image/png" : asset.mime);
    reply.header("cache-control", "private, max-age=31536000, immutable");
    if (q.download === "1") reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(body);
  });
}
