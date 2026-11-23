/** Errors surfaced to API clients. Messages must never contain secrets. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const quotaExceeded = (message: string, details?: unknown) => new AppError(429, "quota_exceeded", message, details);

/**
 * Failure inside a provider call or background job. `retryable` failures are
 * re-queued with exponential backoff until the job's attempt limit.
 */
export type JobErrorKind = "transient" | "rate_limit" | "timeout" | "permanent" | "config" | "content_policy" | "cancelled";

export class JobError extends Error {
  constructor(
    readonly kind: JobErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JobError";
  }

  get retryable(): boolean {
    return this.kind === "transient" || this.kind === "rate_limit" || this.kind === "timeout";
  }

  toJSON() {
    return { kind: this.kind, message: this.message, retryable: this.retryable };
  }
}

const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

export function kindForStatus(status: number): JobErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 409 || status >= 500) return "transient";
  if (status === 401 || status === 403) return "config";
  return "permanent";
}

export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 600_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.min(date - Date.now(), 600_000));
}

export function toJobError(err: unknown): JobError {
  if (err instanceof JobError) return err;
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return new JobError("timeout", "The provider took too long to respond.");
  if (code && TRANSIENT_CODES.has(code)) return new JobError("transient", `Network error (${code}).`);
  return new JobError("permanent", e?.message ? String(e.message).slice(0, 1000) : "Unknown error");
}
