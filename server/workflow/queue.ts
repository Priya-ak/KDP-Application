import type { AppContext } from "../context.ts";
import type { Queryable } from "../db/index.ts";
import { notFound, type JobError } from "../errors.ts";
import { randomId } from "../security/crypto.ts";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job<P = Record<string, unknown>> {
  id: string;
  user_id: string;
  project_id: string | null;
  type: string;
  status: JobStatus;
  payload: P;
  result: unknown;
  error: { kind: string; message: string; retryable: boolean } | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  idempotency_key: string | null;
  progress: number;
  progress_message: string;
  cancel_requested: boolean;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface EnqueueInput {
  userId: string;
  projectId: string | null;
  type: string;
  payload: Record<string, unknown>;
  /** Same key => same job. Prevents duplicate generation when a request is repeated. */
  idempotencyKey?: string;
  maxAttempts?: number;
}

/**
 * Durable, database-backed job queue. Jobs are claimed with
 * FOR UPDATE SKIP LOCKED so several workers (or processes on PostgreSQL)
 * never run the same job twice.
 */
export async function enqueue(app: AppContext, input: EnqueueInput, tx: Queryable = app.db): Promise<{ job: Job; created: boolean }> {
  const rows = await tx.query<Job>(
    `INSERT INTO jobs (id, user_id, project_id, type, payload, idempotency_key, max_attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [randomId("job"), input.userId, input.projectId, input.type, input.payload, input.idempotencyKey ?? null, input.maxAttempts ?? 3],
  );
  if (rows[0]) return { job: rows[0], created: true };
  const existing = (await tx.query<Job>("SELECT * FROM jobs WHERE idempotency_key = $1", [input.idempotencyKey]))[0]!;
  return { job: existing, created: false };
}

export async function claimNext(app: AppContext): Promise<Job | null> {
  const rows = await app.db.query<Job>(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
     WHERE id = (
       SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now()
       ORDER BY run_after, created_at LIMIT 1 FOR UPDATE SKIP LOCKED
     ) RETURNING *`,
  );
  return rows[0] ?? null;
}

export async function completeJob(app: AppContext, id: string, result: unknown) {
  await app.db.query("UPDATE jobs SET status = 'succeeded', result = $2, progress = 100, error = NULL, locked_at = NULL, updated_at = now(), finished_at = now() WHERE id = $1", [id, result ?? {}]);
}

/** Exponential backoff with jitter: 1s, 2s, 4s… capped at 60s, or the provider's Retry-After. */
export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 600_000);
  const base = Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Records a failure. Returns true when the job will be retried. */
export async function failJob(app: AppContext, job: Job, err: JobError): Promise<boolean> {
  if (err.kind === "cancelled") {
    await app.db.query("UPDATE jobs SET status = 'cancelled', error = $2, locked_at = NULL, updated_at = now(), finished_at = now() WHERE id = $1", [job.id, err.toJSON()]);
    return false;
  }
  const retry = err.retryable && job.attempts < job.max_attempts;
  if (retry) {
    const delay = backoffMs(job.attempts, err.retryAfterMs);
    await app.db.query("UPDATE jobs SET status = 'queued', error = $2, locked_at = NULL, run_after = now() + ($3 || ' milliseconds')::interval, updated_at = now() WHERE id = $1", [job.id, err.toJSON(), String(delay)]);
  } else {
    await app.db.query("UPDATE jobs SET status = 'failed', error = $2, locked_at = NULL, updated_at = now(), finished_at = now() WHERE id = $1", [job.id, err.toJSON()]);
  }
  return retry;
}

export async function setProgress(app: AppContext, id: string, progress: number, message: string) {
  await app.db.query("UPDATE jobs SET progress = $2, progress_message = $3, updated_at = now() WHERE id = $1", [id, Math.max(0, Math.min(100, Math.round(progress))), message.slice(0, 200)]);
}

export async function isCancelRequested(app: AppContext, id: string): Promise<boolean> {
  const row = await app.db.one<{ cancel_requested: boolean }>("SELECT cancel_requested FROM jobs WHERE id = $1", [id]);
  return !!row?.cancel_requested;
}

/** Queued jobs are cancelled at once; running jobs stop at their next checkpoint. */
export async function cancelJob(app: AppContext, userId: string, jobId: string): Promise<Job> {
  const job = await app.db.one<Job>("SELECT * FROM jobs WHERE id = $1 AND user_id = $2", [jobId, userId]);
  if (!job) throw notFound("Job");
  if (job.status === "queued") {
    return (await app.db.one<Job>("UPDATE jobs SET status = 'cancelled', cancel_requested = true, updated_at = now(), finished_at = now() WHERE id = $1 RETURNING *", [jobId]))!;
  }
  if (job.status === "running") return (await app.db.one<Job>("UPDATE jobs SET cancel_requested = true, updated_at = now() WHERE id = $1 RETURNING *", [jobId]))!;
  return job;
}

/** After a crash, jobs left "running" past the lease are put back in the queue. */
export async function recoverStaleJobs(app: AppContext, leaseMs = 10 * 60_000): Promise<number> {
  const rows = await app.db.query<{ id: string }>(
    "UPDATE jobs SET status = 'queued', locked_at = NULL, updated_at = now() WHERE status = 'running' AND locked_at < now() - ($1 || ' milliseconds')::interval RETURNING id",
    [String(leaseMs)],
  );
  return rows.length;
}

export async function listProjectJobs(app: AppContext, userId: string, projectId: string, activeOnly = false): Promise<Job[]> {
  return app.db.query<Job>(
    `SELECT * FROM jobs WHERE user_id = $1 AND project_id = $2 ${activeOnly ? "AND status IN ('queued', 'running')" : ""} ORDER BY created_at DESC LIMIT 200`,
    [userId, projectId],
  );
}
