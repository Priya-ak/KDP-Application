import { strToU8, zipSync, type Zippable } from "fflate";
import type { AppContext } from "../context.ts";
import { JobError } from "../errors.ts";
import { downscale, encodePng, toGray } from "../imaging/codec.ts";
import { buildCoverPdf } from "../pdf/cover.ts";
import { inspectPdf } from "../pdf/inspect.ts";
import { buildInteriorPdf } from "../pdf/interior.ts";
import { planInterior } from "../../shared/layout.ts";
import { validateBook } from "../validation/kdp.ts";
import { coverLayout } from "../../shared/kdp.ts";
import { coverConfigSchema, metadataSchema, type ValidationReport } from "../../shared/settings.ts";
import { loadRaster, saveAsset } from "../services/assets.ts";
import { listPages, type ProjectRow } from "../services/projects.ts";
import type { JobContext } from "./worker.ts";

function reportText(r: ValidationReport): string {
  const icon = { pass: "PASS", warning: "WARN", error: "FAIL", manual: "REVIEW" } as const;
  return [
    `KDP validation report — ${r.generatedAt}`,
    `Result: ${r.ready ? "No blocking errors. Review the warnings and manual checks, then confirm in the KDP Print Previewer." : "Blocking errors found. Fix them before uploading."}`,
    `Spec: trim ${r.spec.trim}, ${r.spec.paper} paper, ${r.spec.bleed ? "bleed" : "no bleed"}, ${r.spec.interiorPages} pages, spine ${r.spec.spineWidth}", cover ${r.spec.coverWidth}" x ${r.spec.coverHeight}"`,
    `Summary: ${r.summary.pass} passed, ${r.summary.warning} warnings, ${r.summary.error} errors, ${r.summary.manual} manual checks`,
    "",
    ...r.findings.map((f) => `[${icon[f.status]}] ${f.category} — ${f.title}\n    ${f.detail}${f.fix ? `\n    Fix: ${f.fix}` : ""}`),
    "",
    "Limitations:",
    ...r.limitations.map((l) => `- ${l}`),
  ].join("\n");
}

const safeName = (s: string) => (s || "book").replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "book";

/** Builds interior + cover PDFs from the current project state, validates them and packages everything. */
export async function runExport(app: AppContext, ctx: JobContext) {
  const { projectId, exportId } = ctx.job.payload as { projectId: string; exportId: string };
  const exp = await app.db.one<{ id: string; include_images: boolean; status: string }>("SELECT id, include_images, status FROM exports WHERE id = $1", [exportId]);
  if (!exp) throw new JobError("permanent", "Export record not found.");
  const project = await app.db.one<ProjectRow>("SELECT * FROM projects WHERE id = $1", [projectId]);
  if (!project) throw new JobError("permanent", "The project no longer exists.");
  await app.db.query("UPDATE exports SET status = 'building' WHERE id = $1", [exportId]);
  const pages = await listPages(app, projectId);
  if (!pages.length) throw new JobError("permanent", "The book has no pages yet. Generate the story and pages first.");
  const settings = project.settings;
  const cover = coverConfigSchema.parse(project.cover ?? {});
  const metadata = metadataSchema.parse(project.metadata ?? {});
  const title = cover.title || project.title || "Untitled";
  const subtitle = cover.subtitle || project.subtitle;
  const author = cover.author || project.author;

  await ctx.progress(5, "Laying out the interior");
  const plan = planInterior(settings, pages.map((p) => ({ id: p.id, storyText: settings.mode === "coloring" ? "" : p.story_text, activity: p.activity })));
  const byId = new Map(pages.map((p) => [p.id, p]));
  let done = 0;
  const interior = await buildInteriorPdf({
    settings,
    plan,
    title,
    subtitle,
    author,
    copyrightText: metadata.copyrightText.replace("[YEAR]", String(new Date().getFullYear())) || `Copyright © ${new Date().getFullYear()} ${author || "the author"}. All rights reserved.`,
    content: new Map(pages.map((p) => [p.id, { storyText: settings.mode === "coloring" ? "" : p.story_text, activity: p.activity, sceneTitle: p.scene_title }])),
    loadImage: async (pageId) => {
      const p = byId.get(pageId);
      done++;
      if (done % 4 === 0) {
        await ctx.progress(5 + Math.round((done / pages.length) * 50), `Placing page ${done} of ${pages.length}`);
        await ctx.checkpoint();
      }
      return p?.asset_id ? loadRaster(app, p.asset_id) : null;
    },
  });

  await ctx.progress(60, "Building the cover wrap");
  const layout = coverLayout(plan.trim, plan.pageCount, settings.paper);
  const art = project.cover_art_asset_id ? await loadRaster(app, project.cover_art_asset_id) : null;
  const artAsset = project.cover_art_asset_id ? await app.db.one<{ is_demo: boolean }>("SELECT is_demo FROM assets WHERE id = $1", [project.cover_art_asset_id]) : null;
  const thumbs = [];
  for (const p of pages.filter((p) => p.asset_id).slice(0, 4)) {
    const r = await loadRaster(app, p.asset_id!);
    if (r) thumbs.push(toGray(downscale(r, 700)));
  }
  const coverPdf = await buildCoverPdf({ layout, config: cover, title, subtitle, author, backText: cover.backText || metadata.description.split("\n\n")[0] || project.concept?.synopsis || "", art, thumbnails: thumbs });
  await ctx.checkpoint();

  await ctx.progress(75, "Validating against KDP requirements");
  const [interiorInspection, coverInspection] = await Promise.all([inspectPdf(interior.bytes), inspectPdf(coverPdf.bytes)]);
  const report = validateBook({
    settings,
    plan,
    interior: interior.report,
    interiorPdf: interiorInspection,
    coverLayout: layout,
    cover: coverPdf.report,
    coverPdf: coverInspection,
    pages: pages.map((p) => ({
      id: p.id,
      position: p.position,
      status: p.status,
      isDemo: !!p.asset_is_demo,
      sha256: p.asset_sha256 ?? null,
      qualityStatus: p.quality?.status ?? null,
      qualityMessages: (p.quality?.checks ?? []).filter((c) => c.status !== "pass").map((c) => c.message),
      storyIndex: p.story_index,
    })),
    coverArtIsDemo: !!artAsset?.is_demo,
    hasCoverArt: !!art,
    metadata,
  });

  await ctx.progress(85, "Packaging files");
  const base = safeName(title);
  const interiorAsset = await saveAsset(app, { userId: project.user_id, projectId, kind: "interior_pdf", bytes: interior.bytes, mime: "application/pdf", provider: "system", meta: { exportId, pages: plan.pageCount, filename: `${base}-interior.pdf` } });
  const coverAsset = await saveAsset(app, { userId: project.user_id, projectId, kind: "cover_pdf", bytes: coverPdf.bytes, mime: "application/pdf", provider: "system", meta: { exportId, filename: `${base}-cover.pdf` } });
  const listing = [
    `Title: ${metadata.title || title}`,
    `Subtitle: ${metadata.subtitle || subtitle}`,
    `Author: ${metadata.authorName || author}`,
    `Age range: ${metadata.ageRange}`,
    "",
    "Description:",
    metadata.description,
    "",
    `Keywords (7 slots): ${metadata.keywords.join(" | ")}`,
    `More keyword ideas: ${metadata.keywordCandidates.join(", ")}`,
    `Categories: ${metadata.categories.join(" ; ")}`,
    "",
    `AI disclosure: ${metadata.aiDisclosure}`,
    "",
    metadata.copyrightText,
    "",
    project.metadata_approved ? "Metadata status: approved by the author." : "Metadata status: DRAFT — not yet approved by the author.",
  ].join("\n");
  const files: Zippable = {
    [`${base}-interior.pdf`]: interior.bytes,
    [`${base}-cover.pdf`]: coverPdf.bytes,
    "listing/metadata.json": strToU8(JSON.stringify({ ...metadata, approved: project.metadata_approved }, null, 2)),
    "listing/listing.txt": strToU8(listing),
    "validation/report.json": strToU8(JSON.stringify(report, null, 2)),
    "validation/report.txt": strToU8(reportText(report)),
    "README.txt": strToU8(
      [
        `${title} — print package from AI Coloring Book Studio`,
        "",
        `${base}-interior.pdf  Interior, ${plan.pageCount} pages, ${plan.pageSize.width}" x ${plan.pageSize.height}"${settings.bleed ? " with bleed" : ""}`,
        `${base}-cover.pdf     Full cover wrap, ${layout.width}" x ${layout.height}", spine ${layout.spineWidth}"`,
        "listing/              Book description, keywords and categories",
        "validation/           Automated KDP checks",
        exp.include_images ? "images/               Print-ready page artwork (PNG)" : "",
        "",
        "Upload both PDFs to KDP and review every page in the KDP Print Previewer before publishing.",
        "These files were generated automatically; passing the automated checks does not guarantee KDP acceptance.",
      ]
        .filter((l) => l !== "")
        .join("\n"),
    ),
  };
  if (exp.include_images) {
    for (const p of pages) {
      if (!p.asset_id) continue;
      const r = await loadRaster(app, p.asset_id);
      if (r) files[`images/page-${String(p.position).padStart(3, "0")}.png`] = encodePng(r);
    }
  }
  const zip = zipSync(files, { level: 6 });
  const pkgAsset = await saveAsset(app, { userId: project.user_id, projectId, kind: "package", bytes: zip, mime: "application/zip", provider: "system", meta: { exportId, filename: `${base}-kdp-package.zip` } });

  const status = report.ready ? "ready_for_review" : "blocked";
  await app.db.query(
    "UPDATE exports SET status = $2, interior_asset_id = $3, cover_asset_id = $4, package_asset_id = $5, report = $6, spec = $7, error = NULL, finished_at = now() WHERE id = $1",
    [exportId, status, interiorAsset.id, coverAsset.id, pkgAsset.id, report, { pageCount: plan.pageCount, spineWidth: layout.spineWidth, coverWidth: layout.width, coverHeight: layout.height, pageWidth: plan.pageSize.width, pageHeight: plan.pageSize.height }],
  );
  if (report.ready) await app.db.query("UPDATE projects SET status = 'exported', updated_at = now() WHERE id = $1", [projectId]);
  await ctx.progress(100, status === "ready_for_review" ? "Files ready for KDP review" : "Export blocked by validation errors");
  return { status, errors: report.summary.error, warnings: report.summary.warning };
}
