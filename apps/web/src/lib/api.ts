import type { ApiResponse } from '@tripbng/shared';

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
}

export async function apiFetch<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { body, headers = {}, accessToken, ...rest } = opts;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Browser-level failure: CORS rejection, DNS, server down, network offline.
    // Surface the API base URL so the user can spot a misconfigured env var.
    const reason = err instanceof Error ? err.message : 'Unknown network error';
    throw new ApiCallError(
      'NETWORK_ERROR',
      `Cannot reach API at ${API_BASE} — ${reason}`,
      { apiBase: API_BASE, path },
    );
  }

  let json: ApiResponse<T>;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiCallError('INTERNAL_ERROR', 'Network error', undefined, res.status);
  }

  if (!json.success) {
    throw new ApiCallError(json.error.code, json.error.message, json.error.details, res.status);
  }
  return json.data;
}
