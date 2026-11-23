import { z } from "zod";
import type { AppContext } from "../context.ts";
import { AppError, badRequest, conflict, forbidden, unauthorized } from "../errors.ts";
import { hashPassword, randomId, randomToken, sha256, verifyPassword } from "../security/crypto.ts";

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  csrf: string;
}

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  password: z.string().min(10, "Use at least 10 characters.").max(200),
  name: z.string().trim().max(100).default(""),
});

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) });

// Equalises timing for unknown emails so login doesn't reveal which accounts exist.
const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

export async function register(app: AppContext, input: z.infer<typeof registerSchema>): Promise<User> {
  if (!app.config.allowRegistration) throw forbidden("Registration is disabled on this server.");
  const existing = await app.db.one("SELECT id FROM users WHERE email = $1", [input.email]);
  if (existing) throw conflict("An account with this email already exists.");
  const id = randomId("usr");
  const hash = await hashPassword(input.password);
  const user = await app.db.one<User>("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, name, created_at", [id, input.email, input.name, hash]);
  return user!;
}

export async function login(app: AppContext, input: z.infer<typeof loginSchema>): Promise<User> {
  const row = await app.db.one<User & { password_hash: string }>("SELECT id, email, name, created_at, password_hash FROM users WHERE email = $1", [input.email]);
  const ok = await verifyPassword(input.password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthorized("Email or password is incorrect.");
  const { password_hash: _, ...user } = row;
  return user;
}

export async function createSession(app: AppContext, userId: string, meta: { ip?: string; userAgent?: string }): Promise<{ token: string; csrf: string; expiresAt: Date }> {
  const token = randomToken();
  const csrf = randomToken(18);
  const expiresAt = new Date(Date.now() + app.config.sessionTtlHours * 3600_000);
  await app.db.query("INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [sha256(token), userId, csrf, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 300), expiresAt]);
  return { token, csrf, expiresAt };
}

export async function resolveSession(app: AppContext, token: string): Promise<(SessionInfo & { user: User }) | null> {
  const row = await app.db.one<{ id: string; user_id: string; csrf_token: string; email: string; name: string; created_at: string }>(
    "SELECT s.id, s.user_id, s.csrf_token, u.email, u.name, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()",
    [sha256(token)],
  );
  if (!row) return null;
  return { sessionId: row.id, userId: row.user_id, csrf: row.csrf_token, user: { id: row.user_id, email: row.email, name: row.name, created_at: row.created_at } };
}

export async function destroySession(app: AppContext, token: string) {
  await app.db.query("DELETE FROM sessions WHERE id = $1", [sha256(token)]);
}

export const profileSchema = z.object({ name: z.string().trim().max(100) });

export async function updateProfile(app: AppContext, userId: string, input: z.infer<typeof profileSchema>): Promise<User> {
  return (await app.db.one<User>("UPDATE users SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, email, name, created_at", [userId, input.name]))!;
}

export const passwordSchema = z.object({ currentPassword: z.string().max(200), newPassword: z.string().min(10, "Use at least 10 characters.").max(200) });

export async function changePassword(app: AppContext, userId: string, currentSessionId: string, input: z.infer<typeof passwordSchema>) {
  const row = await app.db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) throw badRequest("Your current password is incorrect.");
  await app.db.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [userId, await hashPassword(input.newPassword)]);
  // Sign out every other session.
  await app.db.query("DELETE FROM sessions WHERE user_id = $1 AND id <> $2", [userId, currentSessionId]);
}

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError(400, "validation_error", first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  return parsed.data;
}
