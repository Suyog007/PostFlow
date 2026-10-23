/** Structured JSON logs with secret redaction. Never log tokens, keys, or full post bodies. */
const SECRET_KEYS = /token|secret|password|authorization|api[-_]?key|cookie|verifier|code$/i;
const SECRET_VALUES = [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, /fw_[A-Za-z0-9]{16,}/g, /gh[pousr]_[A-Za-z0-9]{20,}/g];

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (typeof value === "string") {
    let s = value.length > 500 ? `${value.slice(0, 500)}…` : value;
    for (const re of SECRET_VALUES) s = s.replace(re, "[redacted]");
    return s;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

function write(level: "info" | "warn" | "error", msg: string, data?: Record<string, unknown>) {
  if (process.env.VITEST && level === "info") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(data ? (redact(data) as object) : {}) });
  (level === "error" ? console.error : console.log)(line);
}

/** For best-effort side effects (a notification, a heartbeat): a failure must not stop the work, but it is logged with context. */
export const warnOnError = (what: string, data?: Record<string, unknown>) => (err: unknown) =>
  write("warn", what, { ...data, error: err instanceof Error ? err.message : String(err) });

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
  redact,
};
