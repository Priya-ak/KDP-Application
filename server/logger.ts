const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: 100 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|csrf/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,})\b/g;

/** Removes credential-looking keys and values before anything is written to a log. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]");
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

/** Structured JSON logger; every payload passes through secret redaction. */
export function createLogger(level: string, bindings: Record<string, unknown> = {}): Logger {
  const threshold = LEVELS[(level as LogLevel) in LEVELS ? (level as LogLevel) : "info"];
  const write = (lvl: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...bindings, ...(data ? (redact(data) as Record<string, unknown>) : {}) });
    (LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    debug: (m, d) => write("debug", m, d),
    info: (m, d) => write("info", m, d),
    warn: (m, d) => write("warn", m, d),
    error: (m, d) => write("error", m, d),
    child: (b) => createLogger(level, { ...bindings, ...b }),
  };
}
