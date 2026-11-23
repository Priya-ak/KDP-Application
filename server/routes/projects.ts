import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../app.ts";
import type { AppContext } from "../context.ts";
import { AppError, badRequest, conflict } from "../errors.ts";
import { decodeImage, sniffImageMime } from "../imaging/codec.ts";
import { planInterior } from "../../shared/layout.ts";
import { coverLayout, getTrim } from "../../shared/kdp.ts";
import { parseBody } from "../services/accounts.ts";
import { saveAsset } from "../services/assets.ts";
import {
  characterDto,
  characterSchema,
  createCharacter,
  createProject,
  createProjectSchema,
  deleteCharacter,
  deleteProject,
  getCharacter,
  getProject,
  listCharacters,
  listPages,
  listProjects,
  pageDto,
  projectDto,
  setProjectStatus,
  updateCharacter,
  updateProject,
  updateProjectSchema,
} from "../services/projects.ts";
import { assertImageQuota, assertTextQuota, estimateImageBatch, planCostEstimate } from "../services/usage.ts";
import { cancelJob, enqueue, listProjectJobs, type Job } from "../workflow/queue.ts";

export function jobDto(j: Job) {
  return { id: j.id, type: j.type, status: j.status, progress: j.progress, message: j.progress_message, attempts: j.attempts, maxAttempts: j.max_attempts, error: j.error, payload: j.payload, result: j.result, createdAt: j.created_at, updatedAt: j.updated_at, finishedAt: j.finished_at };
}

/** Reads a single uploaded image, validating type by content (not extension), size and dimensions. */
export async function readImageUpload(req: FastifyRequest, app: AppContext): Promise<Buffer> {
  const file = await req.file();
  if (!file) throw badRequest("No file uploaded.");
  const bytes = await file.toBuffer();
  if (file.file.truncated) throw new AppError(413, "too_large", "File is too large.");
  if (!sniffImageMime(bytes)) throw badRequest("Only PNG and JPEG images are supported.");
  let raster;
  try {
    raster = decodeImage(bytes);
  } catch {
    throw badRequest("The image could not be read. Is the file corrupted?");
  }
  if (raster.width < 300 || raster.height < 300) throw badRequest("The image is too small (minimum 300 × 300 pixels).");
  void app;
  return bytes;
}

export async function registerProjectRoutes(server: FastifyInstance, app: AppContext) {
  const genLimit = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

  server.get("/api/projects", async (req) => {
    const q = req.query as { q?: string; status?: string; folder?: string };
    return { projects: await listProjects(app, requireUser(req).id, { q: q.q?.slice(0, 100), status: q.status, folder: q.folder }) };
  });

  server.post("/api/projects", async (req, reply) => {
    const project = await createProject(app, requireUser(req).id, parseBody(createProjectSchema, req.body));
    return reply.status(201).send({ project: projectDto(project) });
  });

  server.get("/api/projects/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const project = await getProject(app, user.id, id);
    const [characters, pages, jobs, exportRow] = await Promise.all([
      listCharacters(app, id),
      listPages(app, id),
      listProjectJobs(app, user.id, id),
      app.db.one<Record<string, unknown>>("SELECT * FROM exports WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1", [id]),
    ]);
    const plan = planInterior(project.settings, pages.map((p) => ({ id: p.id, storyText: project.settings.mode === "coloring" ? "" : p.story_text, activity: p.activity })));
    const layout = coverLayout(getTrim(project.settings.trimSize), plan.pageCount, project.settings.paper);
    const coverArt = project.cover_art_asset_id ? await app.db.one<{ is_demo: boolean; width: number; height: number }>("SELECT is_demo, width, height FROM assets WHERE id = $1", [project.cover_art_asset_id]) : null;
    return {
      project: projectDto(project),
      characters: characters.map(characterDto),
      pages: pages.map(pageDto),
      jobs: jobs.slice(0, 60).map(jobDto),
      latestExport: exportRow ? exportDto(exportRow) : null,
      interior: { pageCount: plan.pageCount, pageSize: plan.pageSize, margins: plan.margins, kinds: plan.pages.map((p) => p.kind) },
      coverLayout: layout,
      coverArt,
    };
  });

  server.patch("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    return { project: projectDto(await updateProject(app, requireUser(req).id, id, parseBody(updateProjectSchema, req.body))) };
  });

  server.delete("/api/projects/:id", async (req) => {
    const { id } = req.params as { id: string };
    await deleteProject(app, requireUser(req).id, id);
    return { ok: true };
  });

  // Story & plan ---------------------------------------------------------------------
  server.post("/api/projects/:id/plan", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ replace: z.boolean().default(false), instructions: z.string().max(1000).default("") }), req.body);
    const project = await getProject(app, user.id, id);
    const pages = await listPages(app, id);
    if (pages.length && !body.replace) throw conflict("This book already has a plan. Confirm that you want to replace all pages.", { requiresReplace: true });
    if (pages.some((p) => p.locked)) throw conflict("Unlock approved pages before re-planning the book.");
    const active = await listProjectJobs(app, user.id, id, true);
    if (active.some((j) => j.type === "plan_book")) throw conflict("A plan is already being generated.");
    await assertTextQuota(app, user.id);
    const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "plan_book", payload: { projectId: id, instructions: body.instructions }, maxAttempts: 3 });
    await setProjectStatus(app, id, "planning");
    return reply.status(202).send({ job: jobDto(job), estimateUsd: planCostEstimate(app, project.settings.illustrationCount) });
  });

  server.post("/api/projects/:id/story/regenerate", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ pageIds: z.array(z.string()).min(1).max(50), instructions: z.string().max(1000).default("") }), req.body);
    await getProject(app, user.id, id);
    await assertTextQuota(app, user.id);
    const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "regenerate_story", payload: { projectId: id, pageIds: body.pageIds, instructions: body.instructions } });
    return reply.status(202).send({ job: jobDto(job) });
  });

  // Characters ------------------------------------------------------------------------
  server.post("/api/projects/:id/characters", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.status(201).send({ character: characterDto(await createCharacter(app, requireUser(req).id, id, parseBody(characterSchema, req.body))) });
  });

  server.patch("/api/projects/:id/characters/:cid", async (req) => {
    const { id, cid } = req.params as { id: string; cid: string };
    const body = parseBody(characterSchema.partial().extend({ referenceApproved: z.boolean().optional() }), req.body);
    return { character: characterDto(await updateCharacter(app, requireUser(req).id, id, cid, body)) };
  });

  server.delete("/api/projects/:id/characters/:cid", async (req) => {
    const { id, cid } = req.params as { id: string; cid: string };
    await deleteCharacter(app, requireUser(req).id, id, cid);
    return { ok: true };
  });

  server.post("/api/projects/:id/characters/:cid/reference", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, cid } = req.params as { id: string; cid: string };
    await getCharacter(app, user.id, id, cid);
    await assertImageQuota(app, user.id, 1);
    const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "generate_character_ref", payload: { projectId: id, characterId: cid } });
    return reply.status(202).send({ job: jobDto(job) });
  });

  // Cover ---------------------------------------------------------------------------------
  server.post("/api/projects/:id/cover/art", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parseBody(z.object({ prompt: z.string().max(1000).default("") }), req.body);
    await getProject(app, user.id, id);
    await assertImageQuota(app, user.id, 1);
    const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "generate_cover_art", payload: { projectId: id, generation: Date.now(), prompt: body.prompt } });
    return reply.status(202).send({ job: jobDto(job) });
  });

  server.post("/api/projects/:id/cover/art/upload", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const project = await getProject(app, user.id, id);
    const bytes = await readImageUpload(req, app);
    const raster = decodeImage(bytes);
    const asset = await saveAsset(app, { userId: user.id, projectId: project.id, kind: "cover_art", bytes, mime: sniffImageMime(bytes)!, provider: "upload", width: raster.width, height: raster.height, raster, meta: { uploaded: true } });
    await app.db.query("UPDATE projects SET cover_art_asset_id = $2, updated_at = now() WHERE id = $1", [id, asset.id]);
    return { assetId: asset.id };
  });

  // Metadata ---------------------------------------------------------------------------
  server.post("/api/projects/:id/metadata/generate", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await getProject(app, user.id, id);
    await assertTextQuota(app, user.id);
    const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "generate_metadata", payload: { projectId: id } });
    return reply.status(202).send({ job: jobDto(job) });
  });

  // Batch generation with cost confirmation ------------------------------------------------
  const batchSchema = z.object({ scope: z.enum(["missing", "unapproved", "selected"]).default("missing"), pageIds: z.array(z.string()).max(200).default([]), confirm: z.boolean().default(false) });

  const selectBatch = async (userId: string, projectId: string, scope: z.infer<typeof batchSchema>) => {
    const pages = await listPages(app, projectId);
    const busy = new Set((await listProjectJobs(app, userId, projectId, true)).filter((j) => j.type === "generate_page").map((j) => String((j.payload as { pageId?: string }).pageId)));
    return pages.filter((p) => {
      if (p.locked || busy.has(p.id)) return false;
      if (scope.scope === "missing") return !p.asset_id;
      if (scope.scope === "unapproved") return p.status !== "approved";
      return scope.pageIds.includes(p.id);
    });
  };

  server.post("/api/projects/:id/estimate", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const project = await getProject(app, user.id, id);
    const targets = await selectBatch(user.id, id, parseBody(batchSchema, req.body));
    return { estimate: await estimateImageBatch(app, user.id, targets.length, project.settings.generation.quality) };
  });

  server.post("/api/projects/:id/generate", genLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parseBody(batchSchema, req.body);
    const project = await getProject(app, user.id, id);
    const targets = await selectBatch(user.id, id, body);
    if (!targets.length) return { jobs: [], estimate: null, message: "Nothing to generate: every selected page already has artwork or is in progress." };
    const estimate = await estimateImageBatch(app, user.id, targets.length, project.settings.generation.quality);
    if (estimate.needsConfirmation && !body.confirm) throw new AppError(409, "confirmation_required", `This batch will generate ${targets.length} images (about $${estimate.totalUsd.toFixed(2)}). Confirm to continue.`, { estimate });
    await assertImageQuota(app, user.id, targets.length);
    const jobs: Job[] = [];
    await app.db.transaction(async (tx) => {
      for (const p of targets) {
        const gen = p.generation_count + 1;
        await tx.query("UPDATE pages SET generation_count = $2, status = 'queued', last_error = NULL, updated_at = now() WHERE id = $1", [p.id, gen]);
        const { job } = await enqueue(app, { userId: user.id, projectId: id, type: "generate_page", payload: { projectId: id, pageId: p.id, generation: gen }, idempotencyKey: `gen:${p.id}:${gen}`, maxAttempts: 4 }, tx);
        jobs.push(job);
      }
    });
    await setProjectStatus(app, id, "illustrating");
    return reply.status(202).send({ jobs: jobs.map(jobDto), estimate });
  });

  // Jobs ------------------------------------------------------------------------------
  server.get("/api/projects/:id/jobs", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await getProject(app, user.id, id);
    const active = (req.query as { active?: string }).active === "1";
    return { jobs: (await listProjectJobs(app, user.id, id, active)).map(jobDto) };
  });

  server.post("/api/jobs/:jid/cancel", async (req) => {
    const { jid } = req.params as { jid: string };
    return { job: jobDto(await cancelJob(app, requireUser(req).id, jid)) };
  });
}

export function exportDto(e: Record<string, unknown>) {
  return {
    id: e.id,
    status: e.status,
    includeImages: e.include_images,
    interiorAssetId: e.interior_asset_id,
    coverAssetId: e.cover_asset_id,
    packageAssetId: e.package_asset_id,
    spec: e.spec,
    report: e.report,
    error: e.error,
    jobId: e.job_id,
    createdAt: e.created_at,
    finishedAt: e.finished_at,
  };
}
