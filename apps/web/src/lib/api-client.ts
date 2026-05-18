'use client';

import {
  type QueryFunctionContext,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiFetch, ApiCallError } from './api';
import { useAuthStore } from './auth-store';

function buildUrl(path: string, query?: Record<string, unknown>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v == null || v === '') return;
    if (Array.isArray(v)) v.forEach((vv) => params.append(k, String(vv)));
    else params.append(k, String(v));
  });
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// useApiQuery — typed wrapper around TanStack Query that injects the access token.
export function useApiQuery<TData>(
  key: readonly unknown[],
  path: string,
  options?: {
    query?: Record<string, unknown>;
    enabled?: boolean;
    staleTime?: number;
  } & Omit<UseQueryOptions<TData, ApiCallError>, 'queryKey' | 'queryFn'>,
) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { query, enabled, staleTime, ...rest } = options ?? {};
  return useQuery<TData, ApiCallError>({
    queryKey: key,
    enabled: enabled !== false && !!accessToken,
    staleTime,
    queryFn: async ({ signal }: QueryFunctionContext) =>
      apiFetch<TData>(buildUrl(path, query), { accessToken, signal }),
    ...rest,
  });
}

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

// useApiPaginatedQuery — same as useApiQuery but exposes the meta envelope too.
export function useApiPaginatedQuery<TItem>(
  key: readonly unknown[],
  path: string,
  options?: {
    query?: Record<string, unknown>;
    enabled?: boolean;
    staleTime?: number;
  },
) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { query, enabled, staleTime } = options ?? {};
  return useQuery<{ data: TItem[]; meta: ApiMeta }, ApiCallError>({
    queryKey: key,
    enabled: enabled !== false && !!accessToken,
    staleTime,
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const res = await fetch(buildUrl(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000'}${path}`, query), {
        credentials: 'include',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
      const json = (await res.json()) as
        | { success: true; data: TItem[]; meta?: ApiMeta }
        | { success: false; error: { code: string; message: string } };
      if (!json.success) throw new ApiCallError(json.error.code, json.error.message);
      return { data: json.data, meta: json.meta ?? {} };
    },
  });
}

/**
 * Per-mutation `headers()` callback — receives the input and returns a
 * record of extra request headers. The most common use is generating
 * an `Idempotency-Key` per user-initiated action so a rapid double-
 * click on a Pay / Hold button doesn't mint two PNRs. The middleware
 * at `apps/api/src/middleware/idempotency.ts` replays the cached
 * response for any duplicate within 24h.
 */
type ApiMutationOptions<TInput, TOutput> = Omit<
  UseMutationOptions<TOutput, ApiCallError, TInput>,
  'mutationFn'
> & {
  /**
   * Per-mutation `headers()` callback — receives the input and returns
   * a record of extra request headers. Most common use is generating
   * an `Idempotency-Key` per user-initiated action so a rapid double-
   * click on Pay / Hold doesn't mint two PNRs. The middleware at
   * `apps/api/src/middleware/idempotency.ts` replays the cached
   * response for any duplicate within 24h.
   */
  headers?: (input: TInput) => Record<string, string>;
};

export function useApiMutation<TInput, TOutput>(
  path: string | ((input: TInput) => string),
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST',
  options?: ApiMutationOptions<TInput, TOutput>,
) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { headers, ...mutationOptions } = options ?? {};
  return useMutation<TOutput, ApiCallError, TInput>({
    mutationFn: async (input) => {
      const resolvedPath = typeof path === 'function' ? path(input) : path;
      return apiFetch<TOutput>(resolvedPath, {
        method,
        body: method === 'DELETE' ? undefined : input,
        accessToken,
        headers: headers ? headers(input) : undefined,
      });
    },
    ...mutationOptions,
  });
}

// Helper: invalidate a key prefix on mutation success.
export function useInvalidateOnSuccess(prefixes: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return () => {
    prefixes.forEach((p) => qc.invalidateQueries({ queryKey: p }));
  };
}
