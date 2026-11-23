import { resolve } from "node:path";

/**
 * Runtime configuration from environment variables (see .env.example).
 * API keys are read by the provider modules directly from process.env and are
 * never copied into this object, logged, or sent to the browser.
 */
export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  publicUrl: string;
  databaseUrl: string;
  pgliteDataDir: string;
  dataDir: string;
  logLevel: string;
  secureCookies: boolean;
  sessionTtlHours: number;
  allowRegistration: boolean;
  trustProxy: boolean;
  authRateLimitPerMinute: number;
  worker: { mode: "embedded" | "off"; concurrency: number; pollMs: number };
  ai: {
    textProvider: "anthropic" | "groq" | "demo";
    groqModel: string;
    groqBaseUrl: string;
    groqMaxTokens: number;
    anthropicModel: string;
    anthropicEffort: "low" | "medium" | "high" | "xhigh" | "max";
    textTimeoutMs: number;
    /** USD per million tokens, used for cost estimates and usage records. */
    textInputCostPerMTok: number;
    textOutputCostPerMTok: number;
    imageProvider: "openai" | "demo";
    openaiImageModel: string;
    openaiBaseUrl: string;
    imageTimeoutMs: number;
    /** USD per generated image at each quality level (estimate; set from your provider's price list). */
    imageCostUsd: { draft: number; standard: number; high: number };
    demoImageScale: number;
  };
  limits: {
    monthlyImageQuota: number;
    monthlyTextQuota: number;
    /** Batches estimated above this cost need explicit confirmation. */
    batchConfirmUsd: number;
    /** Batches with more images than this need explicit confirmation. */
    batchConfirmImages: number;
    maxUploadBytes: number;
    maxProjectsPerUser: number;
  };
}

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase()));
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v === undefined || v === "" || !Number.isFinite(n) ? fallback : n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" || env.VITEST ? "test" : "development";
  const dataDir = resolve(env.DATA_DIR || ".data");
  const port = num(env.PORT, 8790);
  const textProviderSetting = (env.TEXT_PROVIDER || "auto").toLowerCase();
  const imageProviderSetting = (env.IMAGE_PROVIDER || "auto").toLowerCase();
  // auto: Claude if its key is set, else Groq (free tier) if its key is set, else demo.
  const textProvider: AppConfig["ai"]["textProvider"] =
    textProviderSetting === "demo" ? "demo" : textProviderSetting === "groq" ? "groq" : textProviderSetting === "anthropic" || env.ANTHROPIC_API_KEY ? "anthropic" : env.GROQ_API_KEY ? "groq" : "demo";
  const imageProvider = imageProviderSetting === "demo" ? "demo" : imageProviderSetting === "openai" || env.OPENAI_API_KEY ? "openai" : "demo";
  const effort = (env.ANTHROPIC_EFFORT || "medium") as AppConfig["ai"]["anthropicEffort"];
  return {
    env: nodeEnv,
    host: env.HOST || "127.0.0.1",
    port,
    publicUrl: env.PUBLIC_URL || `http://localhost:${port}`,
    databaseUrl: env.DATABASE_URL || "",
    pgliteDataDir: env.PGLITE_DATA_DIR || resolve(dataDir, "pglite"),
    dataDir,
    logLevel: env.LOG_LEVEL || (nodeEnv === "test" ? "silent" : "info"),
    secureCookies: bool(env.SECURE_COOKIES, nodeEnv === "production"),
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 168),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    trustProxy: bool(env.TRUST_PROXY, false),
    authRateLimitPerMinute: num(env.AUTH_RATE_LIMIT_PER_MINUTE, 10),
    worker: {
      mode: env.WORKER_MODE === "off" ? "off" : "embedded",
      concurrency: Math.max(1, num(env.WORKER_CONCURRENCY, 2)),
      pollMs: Math.max(50, num(env.WORKER_POLL_MS, 500)),
    },
    ai: {
      textProvider,
      groqModel: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      groqBaseUrl: (env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      groqMaxTokens: num(env.GROQ_MAX_TOKENS, 8000),
      anthropicModel: env.ANTHROPIC_MODEL || "claude-opus-5-5",
      anthropicEffort: ["low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : "medium",
      textTimeoutMs: num(env.TEXT_TIMEOUT_MS, 180_000),
      textInputCostPerMTok: num(env.TEXT_INPUT_COST_PER_MTOK, 4),
      textOutputCostPerMTok: num(env.TEXT_OUTPUT_COST_PER_MTOK, 20),
      imageProvider,
      openaiImageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      openaiBaseUrl: (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      imageTimeoutMs: num(env.IMAGE_TIMEOUT_MS, 180_000),
      imageCostUsd: {
        draft: num(env.IMAGE_COST_DRAFT_USD, 0.011),
        standard: num(env.IMAGE_COST_STANDARD_USD, 0.042),
        high: num(env.IMAGE_COST_HIGH_USD, 0.167),
      },
      demoImageScale: Math.min(1, Math.max(0.1, num(env.DEMO_IMAGE_SCALE, 0.5))),
    },
    limits: {
      monthlyImageQuota: num(env.MONTHLY_IMAGE_QUOTA, 400),
      monthlyTextQuota: num(env.MONTHLY_TEXT_QUOTA, 200),
      batchConfirmUsd: num(env.BATCH_CONFIRM_USD, 2),
      batchConfirmImages: num(env.BATCH_CONFIRM_IMAGES, 40),
      maxUploadBytes: num(env.MAX_UPLOAD_MB, 20) * 1024 * 1024,
      maxProjectsPerUser: num(env.MAX_PROJECTS_PER_USER, 200),
    },
  };
}
