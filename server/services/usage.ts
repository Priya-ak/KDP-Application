import type { AppContext } from "../context.ts";
import { quotaExceeded } from "../errors.ts";
import { randomId } from "../security/crypto.ts";
import type { ImageQuality } from "../ai/image.ts";

export interface UsageSummary {
  periodStart: string;
  images: number;
  textCalls: number;
  costUsd: number;
  imageQuota: number;
  textQuota: number;
  providers: { text: string; image: string; textDemo: boolean; imageDemo: boolean };
}

function monthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function usageSummary(app: AppContext, userId: string): Promise<UsageSummary> {
  const start = monthStart();
  const rows = await app.db.query<{ kind: string; units: number; cost: number }>(
    "SELECT kind, COALESCE(SUM(units), 0)::int AS units, COALESCE(SUM(cost_usd), 0)::float AS cost FROM usage_records WHERE user_id = $1 AND created_at >= $2 GROUP BY kind",
    [userId, start],
  );
  const get = (k: string) => rows.find((r) => r.kind === k);
  return {
    periodStart: start.toISOString(),
    images: Number(get("image")?.units ?? 0),
    textCalls: Number(get("text")?.units ?? 0),
    costUsd: Math.round(rows.reduce((s, r) => s + Number(r.cost), 0) * 10000) / 10000,
    imageQuota: app.config.limits.monthlyImageQuota,
    textQuota: app.config.limits.monthlyTextQuota,
    providers: { text: `${app.text.name}:${app.text.model}`, image: `${app.image.name}:${app.image.model}`, textDemo: app.text.isDemo, imageDemo: app.image.isDemo },
  };
}

export function imageUnitCost(app: AppContext, quality: ImageQuality): number {
  return app.image.isDemo || app.image.name === "cloudflare" ? 0 : app.config.ai.imageCostUsd[quality];
}

/** Rough upper estimate for one planning call (inputs ~3k tokens, output ~180 tokens per page). */
export function planCostEstimate(app: AppContext, pages: number): number {
  if (app.text.isDemo || app.text.name === "groq") return 0;
  const input = 3000;
  const output = 800 + pages * 180;
  return (input * app.config.ai.textInputCostPerMTok + output * app.config.ai.textOutputCostPerMTok) / 1_000_000;
}

export interface BatchEstimate {
  images: number;
  unitCostUsd: number;
  totalUsd: number;
  remainingQuota: number;
  needsConfirmation: boolean;
  demo: boolean;
}

export async function estimateImageBatch(app: AppContext, userId: string, images: number, quality: ImageQuality): Promise<BatchEstimate> {
  const usage = await usageSummary(app, userId);
  const unit = imageUnitCost(app, quality);
  const total = Math.round(unit * images * 1000) / 1000;
  return {
    images,
    unitCostUsd: unit,
    totalUsd: total,
    remainingQuota: Math.max(0, usage.imageQuota - usage.images),
    needsConfirmation: total > app.config.limits.batchConfirmUsd || images > app.config.limits.batchConfirmImages,
    demo: app.image.isDemo,
  };
}

/** Throws when the user's monthly quota can't cover the requested work. */
export async function assertImageQuota(app: AppContext, userId: string, images: number) {
  const usage = await usageSummary(app, userId);
  if (usage.images + images > usage.imageQuota)
    throw quotaExceeded(`This would exceed your monthly image quota (${usage.images}/${usage.imageQuota} used).`, { used: usage.images, quota: usage.imageQuota, requested: images });
}

export async function assertTextQuota(app: AppContext, userId: string) {
  const usage = await usageSummary(app, userId);
  if (usage.textCalls + 1 > usage.textQuota) throw quotaExceeded(`Monthly AI writing quota reached (${usage.textCalls}/${usage.textQuota}).`);
}

export async function recordUsage(app: AppContext, rec: { userId: string; projectId: string | null; jobId?: string; kind: "text" | "image"; provider: string; units?: number; inputTokens?: number; outputTokens?: number; costUsd: number }) {
  await app.db.query("INSERT INTO usage_records (id, user_id, project_id, job_id, kind, provider, units, input_tokens, output_tokens, cost_usd) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
    randomId("use"),
    rec.userId,
    rec.projectId,
    rec.jobId ?? null,
    rec.kind,
    rec.provider,
    rec.units ?? 1,
    rec.inputTokens ?? 0,
    rec.outputTokens ?? 0,
    rec.costUsd,
  ]);
}

export function textCost(app: AppContext, inputTokens: number, outputTokens: number): number {
  if (app.text.name === "groq") return 0; // free tier
  return (inputTokens * app.config.ai.textInputCostPerMTok + outputTokens * app.config.ai.textOutputCostPerMTok) / 1_000_000;
}
