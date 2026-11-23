import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { AppContext } from "./context.ts";
import { AppError, forbidden, unauthorized } from "./errors.ts";
import { resolveSession, type User } from "./services/accounts.ts";
import { safeEqual } from "./security/crypto.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerPageRoutes } from "./routes/pages.ts";
import { registerExportRoutes } from "./routes/exports.ts";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    session?: { id: string; csrf: string; token: string };
  }
}

export const SESSION_COOKIE = "cbs_session";

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const PUBLIC_MUTATIONS = new Set(["/api/auth/login", "/api/auth/register"]);

export async function buildApp(app: AppContext, opts: { staticDir?: string } = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: app.config.trustProxy });

  await server.register(cookie);
  await server.register(multipart, { limits: { fileSize: app.config.limits.maxUploadBytes, files: 1, fields: 10 } });
  await server.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.user?.id ?? req.ip,
  });

  // Security headers.
  server.addHook("onSend", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "DENY");
    if (!req.url.startsWith("/api/")) reply.header("content-security-policy", "default-src 'self'; script-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  });

  // Session + CSRF.
  server.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const s = await resolveSession(app, token);
      if (s) {
        req.user = s.user;
        req.session = { id: s.sessionId, csrf: s.csrf, token };
      }
    }
    const path = req.url.split("?")[0]!;
    if (!SAFE_METHODS.has(req.method) && req.session && !PUBLIC_MUTATIONS.has(path)) {
      const header = req.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, req.session.csrf)) throw forbidden("Missing or invalid CSRF token. Reload the page and try again.");
    }
  });

  server.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode === 429) {
      reply.status(429).send({ error: { code: "rate_limited", message: "Too many requests. Please slow down and try again shortly." } });
      return;
    }
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.statusCode === 413) {
      reply.status(413).send({ error: { code: "too_large", message: `File is too large (max ${Math.round(app.config.limits.maxUploadBytes / 1048576)} MB).` } });
      return;
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      reply.status(e.statusCode).send({ error: { code: "bad_request", message: e.message ?? "Bad request" } });
      return;
    }
    app.log.error("request failed", { method: req.method, url: req.url.split("?")[0], error: err });
    reply.status(500).send({ error: { code: "internal", message: "Something went wrong on our side. Please try again." } });
  });

  server.get("/api/health", async () => ({ ok: true }));
  await registerAuthRoutes(server, app);
  await registerProjectRoutes(server, app);
  await registerPageRoutes(server, app);
  await registerExportRoutes(server, app);

  const staticDir = opts.staticDir ?? resolve("dist/web");
  if (existsSync(staticDir)) {
    await server.register(fastifyStatic, {
      root: staticDir,
      wildcard: false,
      // Hashed build assets never change; the HTML shell must always be revalidated.
      setHeaders: (res, path) => res.header("cache-control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"),
    });
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/") || req.url.startsWith("/assets/")) return reply.status(404).send({ error: { code: "not_found", message: "Not found." } });
      reply.header("cache-control", "no-cache");
      return reply.sendFile("index.html");
    });
  } else {
    server.setNotFoundHandler((req, reply) => reply.status(404).send({ error: { code: "not_found", message: "Not found." } }));
  }
  return server;
}
