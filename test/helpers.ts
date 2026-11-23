import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app.ts";
import { createContext, type ContextOverrides } from "../server/bootstrap.ts";
import { loadConfig } from "../server/config.ts";
import type { AppContext } from "../server/context.ts";
import { handlers } from "../server/workflow/handlers.ts";
import { drainQueue } from "../server/workflow/worker.ts";
import { defaultSettings, type BookSettings } from "../shared/settings.ts";

export interface TestEnv {
  app: AppContext;
  server: FastifyInstance;
  dir: string;
  drain(): Promise<number>;
  close(): Promise<void>;
}

/** In-memory PostgreSQL (PGlite), temp object storage and demo/mock providers. */
export async function createTestEnv(overrides: ContextOverrides = {}): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), "cbs-test-"));
  const base = loadConfig({ NODE_ENV: "test", TEXT_PROVIDER: "demo", IMAGE_PROVIDER: "demo", DEMO_IMAGE_SCALE: "0.25", DATA_DIR: dir, PGLITE_DATA_DIR: "memory://" });
  const app = await createContext({ ...overrides, config: { ...base, pgliteDataDir: "memory://", databaseUrl: "", ...overrides.config } });
  const server = await buildApp(app, { staticDir: join(dir, "no-static") });
  return {
    app,
    server,
    dir,
    drain: () => drainQueue(app, handlers),
    async close() {
      await server.close();
      await app.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export class Client {
  cookie = "";
  csrf = "";
  constructor(private readonly server: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.server.inject({
      method: method as "GET",
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf && method !== "GET" ? { "x-csrf-token": this.csrf } : {}), ...headers },
    });
    const setCookie = res.headers["set-cookie"];
    if (setCookie) this.cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0]!;
    let json: any = null;
    try {
      json = res.json();
    } catch {
      json = null;
    }
    return { status: res.statusCode, json, raw: res.rawPayload, headers: res.headers };
  }

  async register(email: string) {
    const r = await this.req("POST", "/api/auth/register", { email, password: "correct horse battery", name: "Test Author" });
    if (r.status !== 201) throw new Error(`register failed: ${JSON.stringify(r.json)}`);
    this.csrf = r.json.csrf;
    return r.json.user;
  }
}

export function settings(overrides: Partial<BookSettings> = {}): BookSettings {
  return defaultSettings(overrides);
}

/** Multipart body for an uploaded file. */
export function multipartBody(filename: string, bytes: Buffer, mime: string) {
  const boundary = `----cbs${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}
