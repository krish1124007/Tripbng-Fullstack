import type { ApiResponse } from '@tripbng/shared';
import { useAuthStore } from './auth-store';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4100';

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
    public status?: number,
  ) {
    super(message);
  }
}

/**
 * Build a human-readable message from an ApiCallError, lifting the
 * specific failing field(s) out of a Zod VALIDATION_ERROR payload.
 *
 * Why: the server formats Zod errors as
 *   { details: { issues: { formErrors: [...], fieldErrors: { ... } } } }
 * and the bare `err.message` is just the generic "Invalid input" — useless
 * to the agent staring at a 6-field booking form. This pulls the first
 * couple of field issues out so the toast tells them where to look.
 */
export function formatApiError(err: unknown): string {
  if (!(err instanceof ApiCallError)) {
    return err instanceof Error ? err.message : 'Something went wrong';
  }
  if (err.code !== 'VALIDATION_ERROR') return err.message;

  const issues = err.details?.issues as
    | { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> }
    | undefined;
  if (!issues) return err.message;

  // Field-level errors first — those tell the agent exactly which input.
  const fieldEntries = Object.entries(issues.fieldErrors ?? {}).filter(
    ([, msgs]) => msgs && msgs.length > 0,
  );
  if (fieldEntries.length > 0) {
    const summary = fieldEntries
      .slice(0, 2)
      .map(([field, msgs]) => `${field}: ${msgs![0]}`)
      .join(' · ');
    const more = fieldEntries.length > 2 ? ` (+${fieldEntries.length - 2} more)` : '';
    return `${err.message} — ${summary}${more}`;
  }
  if (issues.formErrors && issues.formErrors.length > 0) {
    return `${err.message} — ${issues.formErrors[0]}`;
  }
  return err.message;
}

interface RequestOpts extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown;
  headers?: Record<string, string>;
  accessToken?: string | null;
  /** Per-request timeout in ms. Default 60s. Set higher for slow ops (search/export). */
  timeoutMs?: number;
  /**
   * Internal flag set on a request that has already been retried after a
   * silent token refresh — prevents an infinite refresh→401→refresh loop
   * when the refresh token itself is dead.
   */
  skipAuthRefresh?: boolean;
}

// Default per-request timeout. Without one, a stalled/down API leaves the
// request (and its spinner) hanging indefinitely until the browser's own
// network timeout — which reads to the user as a silent "timeout".
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Central error logger — every failed API call lands here so the real cause
 * (network error, HTTP status, raw response body) is visible in the browser
 * console instead of a generic "timeout"/"Network error" toast.
 */
function logApiError(
  kind: string,
  detail: Record<string, unknown>,
  err?: unknown,
): void {
  console.error(`[API ${kind}]`, detail, err ?? '');
}

// The in-memory access token has a short TTL (15 min). When it lapses, the
// next call 401s. Rather than dumping the user to the login screen, we
// transparently hit /auth/refresh (which uses the httpOnly refresh cookie),
// swap in the new token, and retry the original request once.
//
// Many requests can 401 at the same instant the token expires; they all share
// this single in-flight refresh so we don't fire N parallel /auth/refresh
// calls (which would rotate the refresh token N times and invalidate itself).
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const json = (await res.json()) as ApiResponse<{ accessToken: string }>;
        if (!res.ok || !json.success) return null;
        useAuthStore.getState().setAccessToken(json.data.accessToken);
        return json.data.accessToken;
      } catch {
        return null;
      }
    })();
    void refreshPromise.finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface ApiEnvelopeMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

/**
 * Core fetch — returns the full success envelope (data + pagination meta) and
 * carries the silent-refresh-on-401 behaviour. Both apiFetch (data only) and
 * the paginated query hook build on this so the refresh logic lives in exactly
 * one place.
 */
export async function apiFetchEnvelope<T>(
  path: string,
  opts: RequestOpts = {},
): Promise<{ data: T; meta?: ApiEnvelopeMeta }> {
  const { body, headers = {}, accessToken, skipAuthRefresh, timeoutMs, signal, ...rest } = opts;
  const url = `${API_BASE}${path}`;
  const method = (rest.method ?? (body !== undefined ? 'POST' : 'GET')).toUpperCase();
  const startedAt = Date.now();

  // Per-request timeout via AbortController, chained with any caller-supplied
  // signal (e.g. React Query cancellation) so both can abort the fetch.
  const ctrl = new AbortController();
  const limit = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, limit);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    clearTimeout(timer);
    const elapsed = Date.now() - startedAt;
    // Caller-initiated cancellation (React Query) — not an error, re-throw quietly.
    if (signal?.aborted && !timedOut) throw err;
    if (timedOut) {
      logApiError('TIMEOUT', { method, url, afterMs: elapsed, limitMs: limit });
      throw new ApiCallError(
        'TIMEOUT',
        `Request timed out after ${Math.round(elapsed / 1000)}s — ${method} ${path}. The API at ${API_BASE} didn't respond.`,
        { apiBase: API_BASE, path, method, elapsedMs: elapsed },
      );
    }
    // Browser-level failure: CORS rejection, DNS, server down, network offline.
    const reason = err instanceof Error ? err.message : 'Unknown network error';
    logApiError('NETWORK_ERROR', { method, url, apiBase: API_BASE, afterMs: elapsed, reason }, err);
    throw new ApiCallError(
      'NETWORK_ERROR',
      `Cannot reach API at ${API_BASE} — ${reason} (${method} ${path})`,
      { apiBase: API_BASE, path, method, reason },
    );
  } finally {
    clearTimeout(timer);
  }

  // Read the raw text first so we can log the actual body on a parse failure
  // (gateway 502/504 "timeout" pages, HTML error pages, empty bodies, etc.).
  const raw = await res.text();
  let json: ApiResponse<T>;
  try {
    json = JSON.parse(raw) as ApiResponse<T>;
  } catch {
    logApiError('BAD_RESPONSE', {
      method,
      url,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get('content-type'),
      afterMs: Date.now() - startedAt,
      bodyPreview: raw.slice(0, 800),
    });
    throw new ApiCallError(
      'BAD_RESPONSE',
      `Server returned ${res.status} ${res.statusText || ''} with a non-JSON body (${method} ${path}).`,
      { status: res.status, bodyPreview: raw.slice(0, 800) },
      res.status,
    );
  }

  if (!json.success) {
    // Access token lapsed mid-session → refresh once and replay the request.
    // Skipped for /auth/* endpoints (they own the login/refresh flow) and for
    // an already-retried request, so a dead refresh token can't loop forever.
    if (res.status === 401 && !skipAuthRefresh && !path.includes('/auth/')) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return apiFetchEnvelope<T>(path, { ...opts, accessToken: newToken, skipAuthRefresh: true });
      }
      // Refresh failed — the session is genuinely over. Clear auth so the
      // dashboard guard bounces the user to /login instead of leaving them
      // clicking buttons that all 401.
      useAuthStore.getState().clear();
    }
    // Don't spam the console for the routine "session expired" 401 that the
    // refresh flow handles; log every other API-reported failure with detail.
    if (!(res.status === 401 && path.includes('/auth/'))) {
      logApiError('ERROR_RESPONSE', {
        method,
        url,
        status: res.status,
        code: json.error.code,
        message: json.error.message,
        details: json.error.details,
        afterMs: Date.now() - startedAt,
      });
    }
    throw new ApiCallError(json.error.code, json.error.message, json.error.details, res.status);
  }
  return { data: json.data, meta: json.meta };
}

export async function apiFetch<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  return (await apiFetchEnvelope<T>(path, opts)).data;
}
