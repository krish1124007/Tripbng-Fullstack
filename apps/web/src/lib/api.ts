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
