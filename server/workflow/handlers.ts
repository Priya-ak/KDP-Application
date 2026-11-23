import type { AppContext } from "../context.ts";
import { JobError } from "../errors.ts";
import { decodeImage, encodePng } from "../imaging/codec.ts";
import { randomId } from "../security/crypto.ts";
import { buildCharacterPrompt, buildCoverPrompt, buildIllustrationPrompt } from "../ai/prompts.ts";
import { validatePlan, type PlannedPage } from "../ai/schemas.ts";
import type { AspectRatio } from "../ai/image.ts";
import { getTrim } from "../../shared/kdp.ts";
import { metadataSchema } from "../../shared/settings.ts";
import { saveAsset } from "../services/assets.ts";
import { processPageArtwork } from "../services/artwork.ts";
import { listCharacters, listPages, refreshProjectStatus, savePageVersion, setProjectStatus, type CharacterRow, type PageRow, type ProjectRow } from "../services/projects.ts";
import { imageUnitCost, recordUsage, textCost } from "../services/usage.ts";
import { runExport } from "./export.ts";
import type { HandlerMap } from "./worker.ts";

async function loadProject(app: AppContext, projectId: string): Promise<ProjectRow> {
  const p = await app.db.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [projectId]);
  if (!p) throw new JobError("permanent", "The project no longer exists.");
  return p;
}

function aspectForTrim(trimId: string): AspectRatio {
  const t = getTrim(trimId);
  return t.height / t.width > 1.1 ? "portrait" : t.width / t.height > 1.1 ? "landscape" : "square";
}

/**
 * The AI orchestration pipeline, as deterministic job steps:
 * 1-4. plan_book: brief -> concept -> character bible -> page plan (one validated structured call)
 * 5.   prompts are built deterministically from the plan (buildIllustrationPrompt)
 * 6-7. generate_page: image generation + automated quality checks, one job per page
 * 8.   user review happens in the UI (approve / reject / regenerate)
 * 9-10. export_book: interior + cover assembly and print-file validation
 */
export const handlers: HandlerMap = {
  plan_book: {
    async run(app, ctx) {
      const { projectId, instructions } = ctx.job.payload as { projectId: string; instructions?: string };
      const project = await loadProject(app, projectId);
      await ctx.progress(10, "Analyzing the brief");
      await ctx.checkpoint();
      await ctx.progress(25, `Writing the concept and page plan with ${app.text.isDemo ? "the demo writer" : app.text.model}`);
      const result = await app.text.planBook(project.settings, instructions ?? "");
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "text", provider: result.provider, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: textCost(app, result.usage.inputTokens, result.usage.outputTokens) });
      await ctx.progress(70, "Validating the plan");
      let validated;
      try {
        validated = validatePlan(result.data, project.settings);
      } catch (err) {
        throw new JobError(app.text.isDemo ? "permanent" : "transient", `Generated plan failed validation: ${(err as Error).message}`);
      }
      const { plan, issues } = validated;
      await ctx.checkpoint();
      await app.db.transaction(async (tx) => {
        const locked = await tx.query("SELECT id FROM pages WHERE project_id = $1 AND locked", [projectId]);
        if (locked.length) throw new JobError("permanent", "Unlock approved pages before re-planning the book.");
        await tx.query("DELETE FROM pages WHERE project_id = $1", [projectId]);
        await tx.query("DELETE FROM characters WHERE project_id = $1", [projectId]);
        for (const [i, c] of plan.characters.entries())
          await tx.query("INSERT INTO characters (id, project_id, user_id, key, name, role, description, visual_traits, sort) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [randomId("chr"), projectId, project.user_id, c.key, c.name, c.role, c.description, c.visual_traits, i]);
        const chars = plan.characters.map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits }));
        for (const p of plan.pages)
          await tx.query(
            `INSERT INTO pages (id, project_id, user_id, position, story_index, scene_title, story_text, scene_description, activity, characters, illustration_prompt)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [randomId("pg"), projectId, project.user_id, p.page_number, project.settings.mode === "coloring" ? null : p.page_number, p.scene_title, p.story_text, p.scene_description, p.activity, JSON.stringify(p.characters), buildIllustrationPrompt(p, chars, project.settings)],
          );
        // A title the author typed (or one kept from an earlier plan) wins over the generated one.
        const keepTitle = project.title.trim().length > 0;
        await tx.query(
          `UPDATE projects SET title = $2, subtitle = $3, concept = $4, status = 'planned', cover = cover || $5::jsonb, updated_at = now() WHERE id = $1`,
          [
            projectId,
            keepTitle ? project.title : plan.title,
            project.subtitle.trim() ? project.subtitle : plan.subtitle,
            { synopsis: plan.synopsis, tone: plan.tone, outline: plan.outline, provider: result.provider, model: result.model, issues, plannedAt: new Date().toISOString() },
            { title: keepTitle ? project.title : plan.title, subtitle: project.subtitle.trim() ? project.subtitle : plan.subtitle },
          ],
        );
      });
      await ctx.progress(100, "Plan ready");
      return { pages: plan.pages.length, characters: plan.characters.length, issues: issues.length, provider: result.provider };
    },
    async onFailure(app, job, _err, final) {
      if (final) await setProjectStatus(app, String(job.payload.projectId), "draft").catch(() => undefined);
    },
  },

  regenerate_story: {
    async run(app, ctx) {
      const { projectId, pageIds, instructions } = ctx.job.payload as { projectId: string; pageIds: string[]; instructions: string };
      const project = await loadProject(app, projectId);
      const pages = await listPages(app, projectId);
      const chars = await listCharacters(app, projectId);
      const targets = pages.filter((p) => pageIds.includes(p.id) && !p.locked);
      if (!targets.length) return { updated: 0 };
      await ctx.progress(20, "Rewriting selected pages");
      const toPlanned = (p: PageRow): PlannedPage => ({ page_number: p.position, scene_title: p.scene_title, story_text: p.story_text, scene_description: p.scene_description, characters: p.characters, activity: p.activity });
      const result = await app.text.regeneratePages({
        settings: project.settings,
        plan: { title: project.title, synopsis: project.concept?.synopsis ?? "", characters: chars.map((c) => ({ key: c.key, name: c.name, role: c.role, description: c.description, visual_traits: c.visual_traits })) },
        pages: pages.map(toPlanned),
        targets: targets.map((t) => t.position),
        instructions: instructions ?? "",
      });
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "text", provider: result.provider, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: textCost(app, result.usage.inputTokens, result.usage.outputTokens) });
      await ctx.checkpoint();
      const promptChars = chars.map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits }));
      const known = new Set(chars.map((c) => c.key));
      let updated = 0;
      await app.db.transaction(async (tx) => {
        for (const np of result.data.pages) {
          const page = targets.find((t) => t.position === np.page_number);
          if (!page || !np.scene_description.trim()) continue;
          await savePageVersion(tx, page, "story regenerate");
          const characters = np.characters.filter((k) => known.has(k));
          const prompt = page.prompt_edited ? page.illustration_prompt : buildIllustrationPrompt({ scene_description: np.scene_description, characters }, promptChars, project.settings);
          await tx.query("UPDATE pages SET scene_title = $2, story_text = $3, scene_description = $4, activity = $5, characters = $6, illustration_prompt = $7, updated_at = now() WHERE id = $1", [
            page.id,
            np.scene_title,
            project.settings.mode === "coloring" ? "" : np.story_text,
            np.scene_description,
            np.activity,
            JSON.stringify(characters),
            prompt,
          ]);
          updated++;
        }
      });
      return { updated };
    },
  },

  generate_page: {
    async run(app, ctx) {
      const { projectId, pageId, generation } = ctx.job.payload as { projectId: string; pageId: string; generation: number };
      const project = await loadProject(app, projectId);
      const page = await app.db.one<PageRow>("SELECT * FROM pages WHERE id = $1 AND project_id = $2", [pageId, projectId]);
      if (!page) return { skipped: "page deleted" };
      if (page.generation_count !== generation) return { skipped: "superseded by a newer request" };
      if (page.locked) return { skipped: "page is approved and locked" };
      await app.db.query("UPDATE pages SET status = 'generating', updated_at = now() WHERE id = $1", [pageId]);
      await ctx.progress(10, "Preparing prompt");
      const chars = await listCharacters(app, projectId);
      const references: Buffer[] = [];
      if (project.settings.generation.useCharacterReferences && app.image.supportsReferences) {
        for (const c of chars.filter((c) => page.characters.includes(c.key) && c.reference_approved && c.reference_asset_id)) {
          const a = await app.db.one<{ storage_key: string }>("SELECT storage_key FROM assets WHERE id = $1", [c.reference_asset_id]);
          if (a) references.push(encodePng(decodeImage(await app.storage.get(a.storage_key))));
        }
      }
      await ctx.checkpoint();
      await ctx.progress(25, `Drawing with ${app.image.isDemo ? "the demo renderer" : app.image.model}`);
      const quality = project.settings.generation.quality;
      const image = await app.image.generateIllustration(
        { prompt: page.illustration_prompt, kind: "line_art", aspectRatio: aspectForTrim(project.settings.trimSize), quality, referenceImages: references, outputFormat: "png", seed: `${page.id}:${generation}`, theme: project.settings.theme, complexity: project.settings.complexity },
        ctx.signal,
      );
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "image", provider: app.image.name, costUsd: imageUnitCost(app, quality) });
      await ctx.checkpoint();
      await ctx.progress(75, "Running quality checks");
      const processed = await processPageArtwork(app, project, page, image.bytes, {
        provider: app.image.name,
        isDemo: app.image.isDemo,
        kind: "original",
        meta: { prompt: page.illustration_prompt, generation, model: app.image.model, usedReferences: image.usedReferences, references: references.length, revisedPrompt: image.revisedPrompt ?? null },
      });
      // The user may have regenerated or locked the page while we were drawing.
      const updated = await app.db.query(
        "UPDATE pages SET asset_id = $2, status = $3, quality = $4, last_error = NULL, updated_at = now() WHERE id = $1 AND generation_count = $5 AND NOT locked RETURNING id",
        [pageId, processed.asset.id, processed.status, processed.quality, generation],
      );
      await refreshProjectStatus(app, projectId);
      await ctx.progress(100, "Done");
      return { assetId: processed.asset.id, status: processed.status, applied: updated.length > 0, quality: processed.quality.status };
    },
    async onFailure(app, job, err, final) {
      const { pageId, generation } = job.payload as { pageId: string; generation: number };
      await app.db.query("UPDATE pages SET status = $3, last_error = $4, updated_at = now() WHERE id = $1 AND generation_count = $2 AND NOT locked", [
        pageId,
        generation,
        final ? (err.kind === "cancelled" ? "planned" : "failed") : "queued",
        final ? err.message : `Retrying: ${err.message}`,
      ]);
    },
  },

  generate_cover_art: {
    async run(app, ctx) {
      const { projectId, generation, prompt: customPrompt } = ctx.job.payload as { projectId: string; generation: number; prompt?: string };
      const project = await loadProject(app, projectId);
      const chars = await listCharacters(app, projectId);
      const prompt = buildCoverPrompt(project.settings, chars.map((c) => ({ key: c.key, name: c.name, visual_traits: c.visual_traits })), customPrompt ?? "");
      await ctx.progress(20, "Painting the cover artwork");
      const quality = project.settings.generation.quality === "draft" ? "standard" : project.settings.generation.quality;
      const image = await app.image.generateIllustration({ prompt, kind: "cover", aspectRatio: aspectForTrim(project.settings.trimSize), quality, referenceImages: [], outputFormat: "png", seed: `${projectId}:cover:${generation}`, theme: project.settings.theme, complexity: project.settings.complexity }, ctx.signal);
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "image", provider: app.image.name, costUsd: imageUnitCost(app, quality) });
      const raster = decodeImage(image.bytes);
      const asset = await saveAsset(app, { userId: project.user_id, projectId, kind: "cover_art", bytes: image.bytes, mime: "image/png", provider: app.image.name, isDemo: app.image.isDemo, width: raster.width, height: raster.height, meta: { prompt, generation }, raster });
      await app.db.query("UPDATE projects SET cover_art_asset_id = $2, updated_at = now() WHERE id = $1", [projectId, asset.id]);
      return { assetId: asset.id };
    },
  },

  generate_character_ref: {
    async run(app, ctx) {
      const { projectId, characterId } = ctx.job.payload as { projectId: string; characterId: string };
      const project = await loadProject(app, projectId);
      const c = await app.db.one<CharacterRow>("SELECT * FROM characters WHERE id = $1 AND project_id = $2", [characterId, projectId]);
      if (!c) return { skipped: "character deleted" };
      await ctx.progress(20, `Drawing ${c.name}`);
      const quality = project.settings.generation.quality;
      const image = await app.image.generateIllustration({ prompt: buildCharacterPrompt(c, project.settings), kind: "character", aspectRatio: "square", quality, referenceImages: [], outputFormat: "png", seed: `${characterId}:${Date.now()}`, theme: project.settings.theme, complexity: "simple" }, ctx.signal);
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "image", provider: app.image.name, costUsd: imageUnitCost(app, quality) });
      const raster = decodeImage(image.bytes);
      const asset = await saveAsset(app, { userId: project.user_id, projectId, kind: "reference", bytes: image.bytes, mime: "image/png", provider: app.image.name, isDemo: app.image.isDemo, width: raster.width, height: raster.height, meta: { characterId }, raster });
      await app.db.query("UPDATE characters SET reference_asset_id = $2, reference_approved = false, updated_at = now() WHERE id = $1", [characterId, asset.id]);
      return { assetId: asset.id };
    },
  },

  generate_metadata: {
    async run(app, ctx) {
      const { projectId } = ctx.job.payload as { projectId: string };
      const project = await loadProject(app, projectId);
      const pages = await listPages(app, projectId);
      await ctx.progress(30, "Writing the listing");
      const result = await app.text.generateMetadata({
        settings: project.settings,
        title: project.title,
        subtitle: project.subtitle,
        synopsis: project.concept?.synopsis ?? project.settings.theme,
        sceneTitles: pages.map((p) => p.scene_title),
        author: project.author,
        interiorPages: pages.length,
      });
      await recordUsage(app, { userId: project.user_id, projectId, jobId: ctx.job.id, kind: "text", provider: result.provider, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, costUsd: textCost(app, result.usage.inputTokens, result.usage.outputTokens) });
      const d = result.data;
      const metadata = metadataSchema.parse({
        ...project.metadata,
        title: project.metadata?.title || project.title,
        subtitle: project.metadata?.subtitle || project.subtitle,
        titleSuggestions: d.title_suggestions.slice(0, 10),
        subtitleSuggestions: d.subtitle_suggestions.slice(0, 10),
        description: d.description.slice(0, 4000),
        ageRange: d.age_range.slice(0, 40),
        categories: d.categories.slice(0, 10),
        keywords: d.keywords.map((k) => k.slice(0, 50)).slice(0, 7),
        keywordCandidates: d.keyword_candidates.map((k) => k.slice(0, 50)).slice(0, 30),
        authorName: project.metadata?.authorName || project.author,
        copyrightText: d.copyright_text.slice(0, 2000),
        aiDisclosure: "This book contains AI-generated images" + (project.settings.mode === "coloring" ? "." : " and AI-assisted text."),
        checklist: project.metadata?.checklist?.length ? project.metadata.checklist : defaultChecklist(),
      });
      await app.db.query("UPDATE projects SET metadata = $2, metadata_approved = false, updated_at = now() WHERE id = $1", [projectId, metadata]);
      return { provider: result.provider };
    },
  },

  export_book: {
    async run(app, ctx) {
      return runExport(app, ctx);
    },
    async onFailure(app, job, err, final) {
      if (final) await app.db.query("UPDATE exports SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [String(job.payload.exportId), err.message]);
    },
  },
};

export function defaultChecklist() {
  return [
    { id: "previewer", label: "Uploaded both PDFs and checked every page in KDP's Print Previewer", done: false },
    { id: "ai", label: "Answered KDP's AI-generated content questions", done: false },
    { id: "rights", label: "Confirmed I have the rights to all text and artwork", done: false },
    { id: "isbn", label: "Chose a free KDP ISBN or entered my own", done: false },
    { id: "categories", label: "Selected categories and 7 keywords", done: false },
    { id: "pricing", label: "Set the list price and checked the royalty", done: false },
    { id: "proof", label: "Ordered and checked a printed proof copy", done: false },
  ];
}
