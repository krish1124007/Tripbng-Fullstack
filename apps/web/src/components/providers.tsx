'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { PublicBranding } from '@tripbng/shared';
import { useAuthStore } from '@/lib/auth-store';
import { apiFetch, ApiCallError } from '@/lib/api';
import type { AuthUser } from '@/lib/auth-store';
import { BrandingThemeProvider } from '@/components/branding/branding-theme-provider';

interface ProvidersProps {
  children: ReactNode;
  /** SSR-resolved branding snapshot — comes from layout.tsx via the
   *  tripbng_branding cookie. null for anonymous users. */
  initialBranding?: PublicBranding | null;
}

export function Providers({ children, initialBranding = null }: ProvidersProps) {
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
      <BrandingThemeProvider initial={initialBranding}>
        {children}
        <Toaster position="bottom-right" theme="light" />
      </BrandingThemeProvider>
    </QueryClientProvider>
  );
}
