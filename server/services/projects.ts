import { z } from "zod";
import type { AppContext } from "../context.ts";
import type { Queryable } from "../db/index.ts";
import { badRequest, conflict, notFound } from "../errors.ts";
import { randomId } from "../security/crypto.ts";
import { buildIllustrationPrompt, type PromptCharacter } from "../ai/prompts.ts";
import { slugKey, type PlanIssue } from "../ai/schemas.ts";
import { bookSettingsSchema, coverConfigSchema, metadataSchema, type BookMetadata, type BookSettings, type CoverConfig, type PageStatus, type ProjectStatus } from "../../shared/settings.ts";
import type { QualityReport } from "../imaging/lineart.ts";

export interface Concept {
  synopsis?: string;
  tone?: string;
  outline?: string[];
  provider?: string;
  model?: string;
  issues?: PlanIssue[];
  plannedAt?: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  title: string;
  subtitle: string;
  author: string;
  status: ProjectStatus;
  folder: string;
  settings: BookSettings;
  concept: Concept;
  cover: Partial<CoverConfig>;
  cover_art_asset_id: string | null;
  metadata: Partial<BookMetadata>;
  metadata_approved: boolean;
  thumbnail_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharacterRow {
  id: string;
  project_id: string;
  user_id: string;
  key: string;
  name: string;
  role: string;
  description: string;
  visual_traits: string;
  reference_asset_id: string | null;
  reference_approved: boolean;
  sort: number;
}

export interface PageRow {
  id: string;
  project_id: string;
  user_id: string;
  position: number;
  story_index: number | null;
  kind: string;
  scene_title: string;
  story_text: string;
  scene_description: string;
  activity: string;
  characters: string[];
  illustration_prompt: string;
  prompt_edited: boolean;
  asset_id: string | null;
  status: PageStatus;
  locked: boolean;
  approved_at: string | null;
  quality: QualityReport | null;
  generation_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  asset_is_demo?: boolean | null;
  asset_width?: number | null;
  asset_height?: number | null;
  asset_provider?: string | null;
  asset_sha256?: string | null;
}

// ---------------------------------------------------------------------------
// Projects

export const createProjectSchema = z.object({
  title: z.string().trim().max(200).default(""),
  author: z.string().trim().max(150).default(""),
  folder: z.string().trim().max(60).default(""),
  settings: bookSettingsSchema,
});

export async function createProject(app: AppContext, userId: string, input: z.infer<typeof createProjectSchema>): Promise<ProjectRow> {
  const count = await app.db.one<{ n: number }>("SELECT count(*)::int AS n FROM projects WHERE user_id = $1", [userId]);
  if ((count?.n ?? 0) >= app.config.limits.maxProjectsPerUser) throw conflict("You have reached the maximum number of projects. Delete an old project first.");
  const cover: Partial<CoverConfig> = coverConfigSchema.parse({ title: input.title, author: input.author });
  const row = await app.db.one<ProjectRow>(
    "INSERT INTO projects (id, user_id, title, author, folder, settings, cover, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft') RETURNING *",
    [randomId("prj"), userId, input.title, input.author, input.folder, input.settings, cover],
  );
  return row!;
}

export async function getProject(app: AppContext, userId: string, projectId: string, tx: Queryable = app.db): Promise<ProjectRow> {
  const row = (await tx.query<ProjectRow>("SELECT * FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]))[0];
  if (!row) throw notFound("Project");
  return row;
}

export interface ProjectSummary {
  id: string;
  title: string;
  subtitle: string;
  status: ProjectStatus;
  folder: string;
  mode: string;
  trimSize: string;
  pageCount: number;
  illustrated: number;
  approved: number;
  thumbnailAssetId: string | null;
  thumbnailIsDemo: boolean;
  updatedAt: string;
  createdAt: string;
}

export async function listProjects(app: AppContext, userId: string, filter: { q?: string; status?: string; folder?: string }): Promise<ProjectSummary[]> {
  const params: unknown[] = [userId];
  let where = "p.user_id = $1";
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`);
    where += ` AND (lower(p.title) LIKE $${params.length} OR lower(p.settings->>'theme') LIKE $${params.length})`;
  }
  if (filter.status) {
    params.push(filter.status);
    where += ` AND p.status = $${params.length}`;
  }
  if (filter.folder) {
    params.push(filter.folder);
    where += ` AND p.folder = $${params.length}`;
  }
  const rows = await app.db.query<{
    id: string; title: string; subtitle: string; status: ProjectStatus; folder: string; settings: BookSettings; updated_at: string; created_at: string;
    page_count: number; illustrated: number; approved: number; thumb: string | null; thumb_demo: boolean | null;
  }>(
    `SELECT p.id, p.title, p.subtitle, p.status, p.folder, p.settings, p.updated_at, p.created_at,
       (SELECT count(*)::int FROM pages g WHERE g.project_id = p.id) AS page_count,
       (SELECT count(*)::int FROM pages g WHERE g.project_id = p.id AND g.asset_id IS NOT NULL) AS illustrated,
       (SELECT count(*)::int FROM pages g WHERE g.project_id = p.id AND g.status = 'approved') AS approved,
       COALESCE(p.cover_art_asset_id, (SELECT g.asset_id FROM pages g WHERE g.project_id = p.id AND g.asset_id IS NOT NULL ORDER BY g.position LIMIT 1)) AS thumb,
       (SELECT a.is_demo FROM assets a WHERE a.id = COALESCE(p.cover_art_asset_id, (SELECT g.asset_id FROM pages g WHERE g.project_id = p.id AND g.asset_id IS NOT NULL ORDER BY g.position LIMIT 1))) AS thumb_demo
     FROM projects p WHERE ${where} ORDER BY p.updated_at DESC LIMIT 500`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    status: r.status,
    folder: r.folder,
    mode: r.settings.mode,
    trimSize: r.settings.trimSize,
    pageCount: r.page_count,
    illustrated: r.illustrated,
    approved: r.approved,
    thumbnailAssetId: r.thumb,
    thumbnailIsDemo: !!r.thumb_demo,
    updatedAt: r.updated_at,
    createdAt: r.created_at,
  }));
}

export const updateProjectSchema = z.object({
  title: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(300).optional(),
  author: z.string().trim().max(150).optional(),
  folder: z.string().trim().max(60).optional(),
  settings: bookSettingsSchema.optional(),
  cover: coverConfigSchema.partial().optional(),
  metadata: metadataSchema.partial().optional(),
  metadataApproved: z.boolean().optional(),
});

const PROMPT_FIELDS: Array<keyof BookSettings> = ["artStyle", "complexity", "audience"];

export async function updateProject(app: AppContext, userId: string, projectId: string, patch: z.infer<typeof updateProjectSchema>): Promise<ProjectRow> {
  const current = await getProject(app, userId, projectId);
  const settings = patch.settings ?? current.settings;
  const cover = patch.cover ? coverConfigSchema.parse({ ...current.cover, ...patch.cover }) : current.cover;
  const metadata = patch.metadata ? metadataSchema.parse({ ...current.metadata, ...patch.metadata }) : current.metadata;
  // Editing metadata withdraws approval unless approval is set in the same request.
  const metadataApproved = patch.metadataApproved ?? (patch.metadata ? false : current.metadata_approved);
  const row = await app.db.one<ProjectRow>(
    `UPDATE projects SET title = $3, subtitle = $4, author = $5, folder = $6, settings = $7, cover = $8, metadata = $9, metadata_approved = $10, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [projectId, userId, patch.title ?? current.title, patch.subtitle ?? current.subtitle, patch.author ?? current.author, patch.folder ?? current.folder, settings, cover, metadata, metadataApproved],
  );
  if (patch.settings && PROMPT_FIELDS.some((f) => JSON.stringify(patch.settings![f]) !== JSON.stringify(current.settings[f]))) await rebuildPrompts(app, row!);
  return row!;
}

export async function deleteProject(app: AppContext, userId: string, projectId: string) {
  await getProject(app, userId, projectId);
  const keys = await app.db.query<{ storage_key: string; mime: string }>("SELECT storage_key, mime FROM assets WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  await app.db.query("UPDATE jobs SET cancel_requested = true, status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END WHERE project_id = $1", [projectId]);
  await app.db.query("DELETE FROM projects WHERE id = $1 AND user_id = $2", [projectId, userId]);
  for (const k of keys) {
    await app.storage.delete(k.storage_key).catch(() => undefined);
    if (k.mime.startsWith("image/")) await app.storage.delete(`${k.storage_key}.thumb.png`).catch(() => undefined);
  }
}

export async function setProjectStatus(app: AppContext, projectId: string, status: ProjectStatus) {
  await app.db.query("UPDATE projects SET status = $2, updated_at = now() WHERE id = $1", [projectId, status]);
}

/** Moves the project between planned / illustrating / review based on its pages. */
export async function refreshProjectStatus(app: AppContext, projectId: string) {
  const s = await app.db.one<{ total: number; done: number; status: ProjectStatus }>(
    "SELECT (SELECT count(*)::int FROM pages WHERE project_id = $1) AS total, (SELECT count(*)::int FROM pages WHERE project_id = $1 AND asset_id IS NOT NULL) AS done, (SELECT status FROM projects WHERE id = $1) AS status",
    [projectId],
  );
  if (!s || s.status === "planning") return;
  const next: ProjectStatus = s.total === 0 ? "draft" : s.done === 0 ? "planned" : s.done < s.total ? "illustrating" : s.status === "exported" ? "exported" : "review";
  if (next !== s.status) await setProjectStatus(app, projectId, next);
}

// ---------------------------------------------------------------------------
// Characters

export async function listCharacters(app: AppContext, projectId: string, tx: Queryable = app.db): Promise<CharacterRow[]> {
  return tx.query<CharacterRow>("SELECT * FROM characters WHERE project_id = $1 ORDER BY sort, name", [projectId]);
}

export const characterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(80).default(""),
  description: z.string().trim().max(1000).default(""),
  visualTraits: z.string().trim().max(800).default(""),
});

export async function createCharacter(app: AppContext, userId: string, projectId: string, input: z.infer<typeof characterSchema>): Promise<CharacterRow> {
  await getProject(app, userId, projectId);
  let key = slugKey(input.name);
  const taken = new Set((await listCharacters(app, projectId)).map((c) => c.key));
  for (let i = 2; taken.has(key); i++) key = `${slugKey(input.name)}_${i}`;
  return (await app.db.one<CharacterRow>(
    "INSERT INTO characters (id, project_id, user_id, key, name, role, description, visual_traits, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
    [randomId("chr"), projectId, userId, key, input.name, input.role, input.description, input.visualTraits, taken.size],
  ))!;
}

export async function getCharacter(app: AppContext, userId: string, projectId: string, characterId: string): Promise<CharacterRow> {
  const row = await app.db.one<CharacterRow>("SELECT * FROM characters WHERE id = $1 AND project_id = $2 AND user_id = $3", [characterId, projectId, userId]);
  if (!row) throw notFound("Character");
  return row;
}

export async function updateCharacter(app: AppContext, userId: string, projectId: string, characterId: string, input: Partial<z.infer<typeof characterSchema>> & { referenceApproved?: boolean }): Promise<CharacterRow> {
  const c = await getCharacter(app, userId, projectId, characterId);
  if (input.referenceApproved && !c.reference_asset_id) throw badRequest("Generate a reference image before approving it.");
  const row = await app.db.one<CharacterRow>(
    "UPDATE characters SET name = $2, role = $3, description = $4, visual_traits = $5, reference_approved = $6, updated_at = now() WHERE id = $1 RETURNING *",
    [characterId, input.name ?? c.name, input.role ?? c.role, input.description ?? c.description, input.visualTraits ?? c.visual_traits, input.referenceApproved ?? (input.visualTraits !== undefined && input.visualTraits !== c.visual_traits ? false : c.reference_approved)],
  );
  if (input.visualTraits !== undefined || input.name !== undefined) await rebuildPrompts(app, await getProject(app, userId, projectId));
  return row!;
}

export async function deleteCharacter(app: AppContext, userId: string, projectId: string, characterId: string) {
  const c = await getCharacter(app, userId, projectId, characterId);
  await app.db.query("DELETE FROM characters WHERE id = $1", [characterId]);
  await app.db.query("UPDATE pages SET characters = characters - $2::text, updated_at = now() WHERE project_id = $1 AND characters ? $2::text", [projectId, c.key]);
  await rebuildPrompts(app, await getProject(app, userId, projectId));
}

/** Regenerates the deterministic illustration prompt of every page the user hasn't hand-edited. */
export async function rebuildPrompts(app: AppContext, project: ProjectRow, tx: Queryable = app.db) {
  const chars: PromptCharacter[] = (await listCharacters(app, project.id, tx)).map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits }));
  const pages = await tx.query<PageRow>("SELECT * FROM pages WHERE project_id = $1 AND NOT prompt_edited AND NOT locked", [project.id]);
  for (const p of pages) {
    const prompt = buildIllustrationPrompt(p, chars, project.settings);
    if (prompt !== p.illustration_prompt) await tx.query("UPDATE pages SET illustration_prompt = $2, updated_at = now() WHERE id = $1", [p.id, prompt]);
  }
}

// ---------------------------------------------------------------------------
// Pages

const PAGE_SELECT = `SELECT g.*, a.is_demo AS asset_is_demo, a.width AS asset_width, a.height AS asset_height, a.provider AS asset_provider, a.sha256 AS asset_sha256
  FROM pages g LEFT JOIN assets a ON a.id = g.asset_id`;

export async function listPages(app: AppContext, projectId: string, tx: Queryable = app.db): Promise<PageRow[]> {
  return tx.query<PageRow>(`${PAGE_SELECT} WHERE g.project_id = $1 ORDER BY g.position`, [projectId]);
}

export async function getPage(app: AppContext, userId: string, projectId: string, pageId: string, tx: Queryable = app.db): Promise<PageRow> {
  const row = (await tx.query<PageRow>(`${PAGE_SELECT} WHERE g.id = $1 AND g.project_id = $2 AND g.user_id = $3`, [pageId, projectId, userId]))[0];
  if (!row) throw notFound("Page");
  return row;
}

const SNAPSHOT_FIELDS = ["scene_title", "story_text", "scene_description", "activity", "characters", "illustration_prompt", "prompt_edited", "asset_id", "status", "quality"] as const;

async function snapshot(tx: Queryable, page: PageRow, reason: string) {
  const snap = Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, page[f]]));
  await tx.query("INSERT INTO page_versions (id, page_id, snapshot, reason) VALUES ($1, $2, $3, $4)", [randomId("ver"), page.id, snap, reason]);
  // Keep the 20 most recent versions per page.
  await tx.query("DELETE FROM page_versions WHERE page_id = $1 AND id NOT IN (SELECT id FROM page_versions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 20)", [page.id]);
}

function assertUnlocked(page: PageRow) {
  if (page.locked) throw conflict("This page is approved and locked. Unlock it to make changes.");
}

export const updatePageSchema = z.object({
  sceneTitle: z.string().trim().max(200).optional(),
  storyText: z.string().max(2000).optional(),
  sceneDescription: z.string().trim().max(2000).optional(),
  activity: z.string().trim().max(200).optional(),
  characters: z.array(z.string().max(60)).max(12).optional(),
  illustrationPrompt: z.string().trim().max(4000).optional(),
  /** Discard a hand-edited prompt and go back to the generated one. */
  resetPrompt: z.boolean().optional(),
});

export async function updatePage(app: AppContext, userId: string, projectId: string, pageId: string, patch: z.infer<typeof updatePageSchema>): Promise<PageRow> {
  const project = await getProject(app, userId, projectId);
  return app.db.transaction(async (tx) => {
    const page = await getPage(app, userId, projectId, pageId, tx);
    assertUnlocked(page);
    await snapshot(tx, page, "edit");
    const chars = (await listCharacters(app, projectId, tx)).map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits }));
    const characters = patch.characters ? patch.characters.filter((k) => chars.some((c) => c.key === k)) : page.characters;
    const sceneDescription = patch.sceneDescription ?? page.scene_description;
    let prompt = page.illustration_prompt;
    let edited = page.prompt_edited;
    if (patch.illustrationPrompt !== undefined && patch.illustrationPrompt !== page.illustration_prompt) {
      prompt = patch.illustrationPrompt;
      edited = true;
    }
    if (patch.resetPrompt) edited = false;
    if (!edited) prompt = buildIllustrationPrompt({ scene_description: sceneDescription, characters }, chars, project.settings);
    await tx.query(
      `UPDATE pages SET scene_title = $2, story_text = $3, scene_description = $4, activity = $5, characters = $6, illustration_prompt = $7, prompt_edited = $8, updated_at = now() WHERE id = $1`,
      [pageId, patch.sceneTitle ?? page.scene_title, patch.storyText ?? page.story_text, sceneDescription, patch.activity ?? page.activity, JSON.stringify(characters), prompt, edited],
    );
    await tx.query("UPDATE projects SET updated_at = now() WHERE id = $1", [projectId]);
    return getPage(app, userId, projectId, pageId, tx);
  });
}

export async function undoPage(app: AppContext, userId: string, projectId: string, pageId: string): Promise<PageRow> {
  return app.db.transaction(async (tx) => {
    const page = await getPage(app, userId, projectId, pageId, tx);
    assertUnlocked(page);
    const version = (await tx.query<{ id: string; snapshot: Record<string, unknown> }>("SELECT id, snapshot FROM page_versions WHERE page_id = $1 ORDER BY created_at DESC LIMIT 1", [pageId]))[0];
    if (!version) throw conflict("Nothing to undo for this page.");
    const s = version.snapshot as Pick<PageRow, (typeof SNAPSHOT_FIELDS)[number]>;
    // The asset may have been deleted with its project files; fall back to none.
    const assetOk = s.asset_id ? (await tx.query("SELECT 1 FROM assets WHERE id = $1", [s.asset_id])).length > 0 : true;
    await tx.query(
      `UPDATE pages SET scene_title = $2, story_text = $3, scene_description = $4, activity = $5, characters = $6, illustration_prompt = $7, prompt_edited = $8, asset_id = $9, status = $10, quality = $11, updated_at = now() WHERE id = $1`,
      [pageId, s.scene_title, s.story_text, s.scene_description, s.activity, JSON.stringify(s.characters ?? []), s.illustration_prompt, s.prompt_edited, assetOk ? s.asset_id : null, assetOk ? s.status : "planned", s.quality ?? null],
    );
    await tx.query("DELETE FROM page_versions WHERE id = $1", [version.id]);
    return getPage(app, userId, projectId, pageId, tx);
  });
}

export async function addPage(app: AppContext, userId: string, projectId: string, input: { afterPosition?: number; sceneTitle?: string; sceneDescription?: string; storyText?: string }): Promise<PageRow> {
  const project = await getProject(app, userId, projectId);
  return app.db.transaction(async (tx) => {
    const count = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM pages WHERE project_id = $1", [projectId]))[0]!.n;
    if (count >= 200) throw conflict("A book can have at most 200 content pages.");
    const position = Math.min(count + 1, Math.max(1, (input.afterPosition ?? count) + 1));
    await tx.query("UPDATE pages SET position = position + 1 WHERE project_id = $1 AND position >= $2", [projectId, position]);
    const chars = (await listCharacters(app, projectId, tx)).map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits }));
    const description = input.sceneDescription?.trim() || `A new scene about ${project.settings.theme}`;
    const id = randomId("pg");
    await tx.query(
      `INSERT INTO pages (id, project_id, user_id, position, scene_title, story_text, scene_description, illustration_prompt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, projectId, userId, position, input.sceneTitle?.trim() || "New page", input.storyText ?? "", description, buildIllustrationPrompt({ scene_description: description, characters: [] }, chars, project.settings)],
    );
    await tx.query("UPDATE projects SET updated_at = now() WHERE id = $1", [projectId]);
    return getPage(app, userId, projectId, id, tx);
  });
}

export async function duplicatePage(app: AppContext, userId: string, projectId: string, pageId: string): Promise<PageRow> {
  return app.db.transaction(async (tx) => {
    const p = await getPage(app, userId, projectId, pageId, tx);
    const count = (await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM pages WHERE project_id = $1", [projectId]))[0]!.n;
    if (count >= 200) throw conflict("A book can have at most 200 content pages.");
    await tx.query("UPDATE pages SET position = position + 1 WHERE project_id = $1 AND position > $2", [projectId, p.position]);
    const id = randomId("pg");
    await tx.query(
      `INSERT INTO pages (id, project_id, user_id, position, story_index, scene_title, story_text, scene_description, activity, characters, illustration_prompt, prompt_edited, asset_id, status, quality)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [id, projectId, userId, p.position + 1, p.story_index, `${p.scene_title} (copy)`, p.story_text, p.scene_description, p.activity, JSON.stringify(p.characters), p.illustration_prompt, p.prompt_edited, p.asset_id, p.asset_id ? (p.status === "approved" ? "generated" : p.status) : "planned", p.quality],
    );
    return getPage(app, userId, projectId, id, tx);
  });
}

export async function deletePage(app: AppContext, userId: string, projectId: string, pageId: string) {
  await app.db.transaction(async (tx) => {
    const p = await getPage(app, userId, projectId, pageId, tx);
    assertUnlocked(p);
    await tx.query("DELETE FROM pages WHERE id = $1", [pageId]);
    await tx.query("UPDATE pages SET position = position - 1 WHERE project_id = $1 AND position > $2", [projectId, p.position]);
    await tx.query("UPDATE jobs SET status = 'cancelled', cancel_requested = true WHERE project_id = $1 AND status = 'queued' AND payload->>'pageId' = $2", [projectId, pageId]);
  });
  await refreshProjectStatus(app, projectId);
}

/**
 * Applies a complete new order. The list must contain every page exactly once,
 * so a stale client can't drop or duplicate pages. Returns a warning when a
 * story book no longer reads in narrative order.
 */
export async function reorderPages(app: AppContext, userId: string, projectId: string, orderedIds: string[]): Promise<{ pages: PageRow[]; warning: string | null }> {
  const project = await getProject(app, userId, projectId);
  const pages = await app.db.transaction(async (tx) => {
    const current = await tx.query<{ id: string }>("SELECT id FROM pages WHERE project_id = $1", [projectId]);
    const ids = new Set(current.map((c) => c.id));
    if (orderedIds.length !== ids.size || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !ids.has(id)))
      throw conflict("The page list changed since you loaded it. Refresh and try again.");
    // Two passes avoid transient duplicate positions.
    for (let i = 0; i < orderedIds.length; i++) await tx.query("UPDATE pages SET position = $2 WHERE id = $1", [orderedIds[i], -(i + 1)]);
    await tx.query("UPDATE pages SET position = -position, updated_at = now() WHERE project_id = $1", [projectId]);
    await tx.query("UPDATE projects SET updated_at = now() WHERE id = $1", [projectId]);
    return listPages(app, projectId, tx);
  });
  const story = pages.filter((p) => p.story_index !== null);
  const outOfOrder = project.settings.mode !== "coloring" && story.some((p, i) => i > 0 && p.story_index! < story[i - 1]!.story_index!);
  return { pages, warning: outOfOrder ? "The story pages are no longer in their original order. Check that the text still reads correctly, or restore the story order." : null };
}

export async function restoreStoryOrder(app: AppContext, userId: string, projectId: string) {
  const pages = await listPages(app, projectId);
  const sorted = [...pages].sort((a, b) => (a.story_index ?? 1e9) - (b.story_index ?? 1e9) || a.position - b.position);
  return reorderPages(app, userId, projectId, sorted.map((p) => p.id));
}

export async function setPageReview(app: AppContext, userId: string, projectId: string, pageId: string, action: "approve" | "reject" | "unlock"): Promise<PageRow> {
  return app.db.transaction(async (tx) => {
    const p = await getPage(app, userId, projectId, pageId, tx);
    if (action === "approve") {
      if (!p.asset_id && (await getProject(app, userId, projectId, tx)).settings.mode !== "story") throw conflict("Generate or upload artwork before approving this page.");
      await tx.query("UPDATE pages SET status = 'approved', locked = true, approved_at = now(), updated_at = now() WHERE id = $1", [pageId]);
    } else if (action === "reject") {
      assertUnlocked(p);
      await tx.query("UPDATE pages SET status = 'rejected', updated_at = now() WHERE id = $1", [pageId]);
    } else {
      await tx.query("UPDATE pages SET locked = false, status = CASE WHEN status = 'approved' THEN (CASE WHEN asset_id IS NULL THEN 'planned' ELSE 'generated' END) ELSE status END, approved_at = NULL, updated_at = now() WHERE id = $1", [pageId]);
    }
    return getPage(app, userId, projectId, pageId, tx);
  });
}

/** Marks a page for (re)generation. Returns the new generation number used as the job's idempotency key. */
export async function bumpGeneration(app: AppContext, userId: string, projectId: string, pageId: string, tx: Queryable = app.db): Promise<PageRow> {
  const p = await getPage(app, userId, projectId, pageId, tx);
  assertUnlocked(p);
  if (p.asset_id) await snapshot(tx, p, "regenerate");
  await tx.query("UPDATE pages SET generation_count = generation_count + 1, status = 'queued', last_error = NULL, updated_at = now() WHERE id = $1", [pageId]);
  return getPage(app, userId, projectId, pageId, tx);
}

export async function savePageVersion(tx: Queryable, page: PageRow, reason: string) {
  await snapshot(tx, page, reason);
}

/** Serialized page for the API. */
export function pageDto(p: PageRow) {
  return {
    id: p.id,
    position: p.position,
    storyIndex: p.story_index,
    sceneTitle: p.scene_title,
    storyText: p.story_text,
    sceneDescription: p.scene_description,
    activity: p.activity,
    characters: p.characters,
    illustrationPrompt: p.illustration_prompt,
    promptEdited: p.prompt_edited,
    status: p.status,
    locked: p.locked,
    approvedAt: p.approved_at,
    quality: p.quality,
    generationCount: p.generation_count,
    lastError: p.last_error,
    asset: p.asset_id ? { id: p.asset_id, isDemo: !!p.asset_is_demo, width: p.asset_width, height: p.asset_height, provider: p.asset_provider } : null,
    updatedAt: p.updated_at,
  };
}

export function characterDto(c: CharacterRow) {
  return { id: c.id, key: c.key, name: c.name, role: c.role, description: c.description, visualTraits: c.visual_traits, referenceAssetId: c.reference_asset_id, referenceApproved: c.reference_approved };
}

export function projectDto(p: ProjectRow) {
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    author: p.author,
    status: p.status,
    folder: p.folder,
    settings: p.settings,
    concept: p.concept,
    cover: coverConfigSchema.parse(p.cover ?? {}),
    coverArtAssetId: p.cover_art_asset_id,
    metadata: metadataSchema.parse(p.metadata ?? {}),
    metadataApproved: p.metadata_approved,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}
