import type { AppContext } from "../context.ts";
import { JobError, toJobError } from "../errors.ts";
import { claimNext, completeJob, failJob, isCancelRequested, recoverStaleJobs, setProgress, type Job } from "./queue.ts";

export interface JobContext {
  job: Job;
  /** Aborted when the user cancels the job. */
  signal: AbortSignal;
  progress(percent: number, message: string): Promise<void>;
  /** Throws a cancellation error if the user cancelled the job. */
  checkpoint(): Promise<void>;
}

export interface JobHandler {
  run(app: AppContext, ctx: JobContext): Promise<unknown>;
  /** Called after every failure; `final` is true when no retry is scheduled. */
  onFailure?(app: AppContext, job: Job, err: JobError, final: boolean): Promise<void>;
}

export type HandlerMap = Record<string, JobHandler>;

/** Runs one claimed job to completion, failure or cancellation. */
export async function runJob(app: AppContext, handlers: HandlerMap, job: Job): Promise<void> {
  const handler = handlers[job.type];
  const log = app.log.child({ jobId: job.id, type: job.type });
  if (!handler) {
    await failJob(app, job, new JobError("permanent", `No handler for job type ${job.type}`));
    return;
  }
  const controller = new AbortController();
  const poll = setInterval(() => {
    isCancelRequested(app, job.id)
      .then((c) => c && controller.abort())
      .catch(() => undefined);
  }, 1000);
  const ctx: JobContext = {
    job,
    signal: controller.signal,
    progress: (p, m) => setProgress(app, job.id, p, m),
    checkpoint: async () => {
      if (controller.signal.aborted || (await isCancelRequested(app, job.id))) throw new JobError("cancelled", "Cancelled by the user.");
    },
  };
  try {
    await ctx.checkpoint();
    const result = await handler.run(app, ctx);
    await completeJob(app, job.id, result);
    log.debug("job succeeded");
  } catch (raw) {
    const err = controller.signal.aborted ? new JobError("cancelled", "Cancelled by the user.") : toJobError(raw);
    const retrying = await failJob(app, job, err);
    log.warn("job failed", { kind: err.kind, message: err.message, attempt: job.attempts, retrying });
    await handler.onFailure?.(app, job, err, !retrying).catch((e: unknown) => log.error("failure hook error", { error: e }));
  } finally {
    clearInterval(poll);
  }
}

/** Embedded worker loop with bounded concurrency. */
export function startWorker(app: AppContext, handlers: HandlerMap): { stop(): Promise<void> } {
  let stopping = false;
  const slots: Promise<void>[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  void recoverStaleJobs(app).then((n) => n && app.log.info("recovered stale jobs", { count: n }));
  for (let i = 0; i < app.config.worker.concurrency; i++) {
    slots.push(
      (async () => {
        while (!stopping) {
          try {
            const job = await claimNext(app);
            if (!job) {
              await sleep(app.config.worker.pollMs);
              continue;
            }
            await runJob(app, handlers, job);
          } catch (err) {
            app.log.error("worker loop error", { error: err });
            await sleep(app.config.worker.pollMs * 4);
          }
        }
      })(),
    );
  }
  return {
    async stop() {
      stopping = true;
      await Promise.all(slots);
    },
  };
}

/** Test/CLI helper: processes ready jobs inline until the queue is empty. */
export async function drainQueue(app: AppContext, handlers: HandlerMap, maxJobs = 1000): Promise<number> {
  let n = 0;
  for (; n < maxJobs; n++) {
    const job = await claimNext(app);
    if (!job) break;
    await runJob(app, handlers, job);
  }
  return n;
}
