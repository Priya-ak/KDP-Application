/** Thin API client: session cookie + CSRF header, normalized errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: any,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized && !path.startsWith("/api/auth/")) onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const patch = <T = any>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const put = <T = any>(path: string, body: unknown) => api<T>("PUT", path, body);
export const del = <T = any>(path: string) => api<T>("DELETE", path);

export function upload<T = any>(path: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<T>("POST", path, form);
}

export const assetUrl = (id: string, opts: { thumb?: boolean; download?: boolean } = {}) =>
  `/api/assets/${encodeURIComponent(id)}${opts.thumb || opts.download ? "?" : ""}${opts.thumb ? "variant=thumb" : ""}${opts.thumb && opts.download ? "&" : ""}${opts.download ? "download=1" : ""}`;
