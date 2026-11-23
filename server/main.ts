import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (existsSync(".env")) process.loadEnvFile(".env");

const { buildApp } = await import("./app.ts");
const { createContext } = await import("./bootstrap.ts");
const { handlers } = await import("./workflow/handlers.ts");
const { startWorker } = await import("./workflow/worker.ts");

const app = await createContext();
const here = dirname(fileURLToPath(import.meta.url));
// Bundled: dist/server/main.js -> dist/web. Source (tsx): server/main.ts -> dist/web.
const staticDir = [resolve(here, "../web"), resolve(here, "../dist/web")].find((d) => existsSync(d));
const server = await buildApp(app, { staticDir });
const worker = app.config.worker.mode === "embedded" ? startWorker(app, handlers) : null;

await server.listen({ host: app.config.host, port: app.config.port });
app.log.info("AI Coloring Book Studio listening", {
  url: app.config.publicUrl,
  database: app.db.driver,
  text: `${app.text.name}${app.text.isDemo ? " (demo)" : ""}`,
  image: `${app.image.name}${app.image.isDemo ? " (demo)" : ""}`,
  worker: app.config.worker.mode,
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await server.close();
  await worker?.stop();
  await app.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
