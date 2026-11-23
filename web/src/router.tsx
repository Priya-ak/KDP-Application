import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/** Minimal History API router. */
const listeners = new Set<() => void>();

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  listeners.forEach((l) => l());
}

export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return path;
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i]!.startsWith(":")) params[p[i]!.slice(1)] = decodeURIComponent(s[i]!);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Link({ to, className, activeClass, exact, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; activeClass?: string; exact?: boolean }) {
  const path = usePath();
  const active = exact ? path === to : path === to || path.startsWith(`${to}/`);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={onClick} className={[className, active && activeClass].filter(Boolean).join(" ") || undefined} {...rest} />;
}
