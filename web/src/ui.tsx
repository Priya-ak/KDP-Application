import { AlertTriangle, CheckCircle2, CircleHelp, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "./api.ts";

// Toasts ---------------------------------------------------------------------------------

type Toast = { id: number; kind: "info" | "error" | "success"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? <XCircle size={18} /> : t.kind === "success" ? <CheckCircle2 size={18} /> : <Info size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return {
    info: (t: string) => push("info", t),
    success: (t: string) => push("success", t),
    error: (e: unknown) => push("error", e instanceof ApiError || e instanceof Error ? e.message : String(e)),
  };
}

/** Wraps an async action with a busy flag and error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const r = await fn();
        if (success) toast.success(success);
        return r;
      } catch (e) {
        toast.error(e);
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

// Primitives --------------------------------------------------------------------------------

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`badge ${status}`}>{children ?? status.replace(/_/g, " ")}</span>;
}

export function DemoBadge() {
  return (
    <span className="badge demo" title="Placeholder content from demo mode, not AI-generated">
      DEMO
    </span>
  );
}

export function Alert({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "success" | "demo"; children: ReactNode }) {
  const Icon = kind === "error" ? XCircle : kind === "warn" || kind === "demo" ? AlertTriangle : kind === "success" ? CheckCircle2 : Info;
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : undefined}>
      <Icon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
      <div className="grow">{children}</div>
    </div>
  );
}

export function StatusIcon({ status }: { status: string }) {
  if (status === "pass") return <CheckCircle2 size={20} color="var(--success)" />;
  if (status === "warning") return <AlertTriangle size={20} color="var(--warning)" />;
  if (status === "error") return <XCircle size={20} color="var(--danger)" />;
  return <CircleHelp size={20} color="var(--sky)" />;
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer && (
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Confirm({ title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner size={14} />} {confirmLabel}
          </button>
        </>
      }
    >
      <div className="muted">{body}</div>
    </Modal>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div style={{ marginBottom: 10 }}>{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Debounced autosave for a text value. Returns [value, setValue, state]. */
export function useAutosave(initial: string, save: (v: string) => Promise<unknown>, delay = 800): [string, (v: string) => void, "idle" | "saving" | "saved" | "error"] {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(initial);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    // Accept server updates when the user isn't mid-edit.
    if (!timer.current) {
      setValue(initial);
      latest.current = initial;
    }
  }, [initial]);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      void saveRef.current(latest.current);
    }
  }, []);
  const update = (v: string) => {
    setValue(v);
    latest.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      setState("saving");
      try {
        await saveRef.current(v);
        setState("saved");
      } catch {
        setState("error");
      }
    }, delay);
  };
  return [value, update, state];
}

export function SaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return null;
  return (
    <span className="saving" style={state === "error" ? { color: "var(--danger)" } : undefined}>
      {state === "saving" ? <Spinner size={11} /> : null}
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Not saved — check your connection"}
    </span>
  );
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  planning: "Writing plan",
  planned: "Planned",
  illustrating: "Illustrating",
  review: "In review",
  exported: "Exported",
};
