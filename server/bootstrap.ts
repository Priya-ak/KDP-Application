import { resolve } from "node:path";
import { createImageProvider, type ImageProvider } from "./ai/image.ts";
import { createTextProvider, type TextProvider } from "./ai/text.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import type { AppContext } from "./context.ts";
import { createDb } from "./db/index.ts";
import { migrate } from "./db/migrate.ts";
import { createLogger } from "./logger.ts";
import { LocalStorage, S3Storage, type ObjectStorage } from "./storage.ts";

export interface ContextOverrides {
  config?: Partial<AppConfig>;
  text?: TextProvider;
  image?: ImageProvider;
}

/** Creates the database, storage and providers, and applies migrations. */
export async function createContext(overrides: ContextOverrides = {}): Promise<AppContext> {
  const config = { ...loadConfig(), ...overrides.config } as AppConfig;
  const log = createLogger(config.logLevel);
  const db = await createDb(config);
  await migrate(db);
  const env = process.env;
  // Set S3_BUCKET (+ endpoint and keys) to keep files in S3-compatible storage; otherwise use the local disk.
  const storage: ObjectStorage = env.S3_BUCKET
    ? new S3Storage({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION || "us-east-1",
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
      })
    : new LocalStorage(resolve(config.dataDir, "objects"));
  return { config, db, storage, log, text: overrides.text ?? createTextProvider(config), image: overrides.image ?? createImageProvider(config) };
}
