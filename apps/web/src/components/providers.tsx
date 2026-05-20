'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/lib/auth-store';
import { apiFetch, ApiCallError } from '@/lib/api';
import type { AuthUser } from '@/lib/auth-store';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  const setAuth = useAuthStore((s) => s.setAuth);
  const setHydrated = useAuthStore((s) => s.setHydrated);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const refresh = await apiFetch<{ accessToken: string }>('/api/v1/auth/refresh', {
          method: 'POST',
        });
        if (cancelled) return;
        const me = await apiFetch<AuthUser>('/api/v1/auth/me', {
          accessToken: refresh.accessToken,
        });
        if (cancelled) return;
        setAuth(me, refresh.accessToken);
      } catch (err) {
        if (!(err instanceof ApiCallError)) throw err;
        // Anonymous — fine.
      } finally {
        if (!cancelled) setHydrated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAuth, setHydrated]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-right" theme="light" />
    </QueryClientProvider>
  );
}
