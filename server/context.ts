import type { ImageProvider } from "./ai/image.ts";
import type { TextProvider } from "./ai/text.ts";
import type { AppConfig } from "./config.ts";
import type { Db } from "./db/index.ts";
import type { Logger } from "./logger.ts";
import type { ObjectStorage } from "./storage.ts";

export interface AppContext {
  config: AppConfig;
  db: Db;
  storage: ObjectStorage;
  log: Logger;
  text: TextProvider;
  image: ImageProvider;
}
