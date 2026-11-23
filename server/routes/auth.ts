import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireUser, SESSION_COOKIE } from "../app.ts";
import type { AppContext } from "../context.ts";
import { changePassword, createSession, destroySession, login, loginSchema, parseBody, passwordSchema, profileSchema, register, registerSchema, updateProfile } from "../services/accounts.ts";
import { usageSummary } from "../services/usage.ts";

export async function registerAuthRoutes(server: FastifyInstance, app: AppContext) {
  const authLimit = { config: { rateLimit: { max: app.config.authRateLimitPerMinute, timeWindow: "1 minute", keyGenerator: (req: FastifyRequest) => req.ip } } };

  const startSession = async (req: FastifyRequest, reply: FastifyReply, userId: string) => {
    const s = await createSession(app, userId, { ip: req.ip, userAgent: req.headers["user-agent"] });
    reply.setCookie(SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "lax", secure: app.config.secureCookies, path: "/", expires: s.expiresAt });
    return s.csrf;
  };

  server.post("/api/auth/register", authLimit, async (req, reply) => {
    const user = await register(app, parseBody(registerSchema, req.body));
    const csrf = await startSession(req, reply, user.id);
    return reply.status(201).send({ user, csrf });
  });

  server.post("/api/auth/login", authLimit, async (req, reply) => {
    const user = await login(app, parseBody(loginSchema, req.body));
    const csrf = await startSession(req, reply, user.id);
    return { user, csrf };
  });

  server.post("/api/auth/logout", async (req, reply) => {
    if (req.session) await destroySession(app, req.session.token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  server.get("/api/auth/me", async (req) => {
    if (!req.user) return { user: null, csrf: null, config: publicConfig(app) };
    return { user: req.user, csrf: req.session!.csrf, config: publicConfig(app) };
  });

  server.patch("/api/account", async (req) => ({ user: await updateProfile(app, requireUser(req).id, parseBody(profileSchema, req.body)) }));

  server.post("/api/account/password", authLimit, async (req) => {
    await changePassword(app, requireUser(req).id, req.session!.id, parseBody(passwordSchema, req.body));
    return { ok: true };
  });

  server.get("/api/usage", async (req) => usageSummary(app, requireUser(req).id));
}

/** Non-secret configuration the UI needs (never includes keys). */
export function publicConfig(app: AppContext) {
  return {
    allowRegistration: app.config.allowRegistration,
    textProvider: { name: app.text.name, model: app.text.model, demo: app.text.isDemo },
    imageProvider: { name: app.image.name, model: app.image.model, demo: app.image.isDemo, supportsReferences: app.image.supportsReferences },
    limits: { monthlyImageQuota: app.config.limits.monthlyImageQuota, monthlyTextQuota: app.config.limits.monthlyTextQuota, batchConfirmUsd: app.config.limits.batchConfirmUsd, batchConfirmImages: app.config.limits.batchConfirmImages, maxUploadMb: Math.round(app.config.limits.maxUploadBytes / 1048576) },
    imageCostUsd: app.image.isDemo ? { draft: 0, standard: 0, high: 0 } : app.config.ai.imageCostUsd,
  };
}
