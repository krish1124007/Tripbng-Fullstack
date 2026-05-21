'use client';

// BrandingThemeProvider — paints the per-tenant theme onto :root by
// setting the --color-primary / --color-primary-hover / etc. CSS
// variables. Wraps the dashboard so every page can read theme.logoUrl
// via useBranding() and any Tailwind `primary` / `secondary` class
// picks up the right colour.
//
// Hydration plan:
//   - SSR layout reads the JWT cookie + does a server-side fetch to
//     /api/v1/settings/branding and injects a <style> tag in <head>
//     before React mounts → no flash of TripBng-default colours.
//   - This client provider then takes over: it re-fetches on mount
//     (in case the cookie was stale) and listens for "branding-
//     updated" events fired by the settings page so the portal
//     repaints without a hard reload.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicBranding } from '@tripbng/shared';

interface BrandingContextValue {
  branding: PublicBranding | null;
  /** Force the provider to re-pull /settings/branding. Called by the
   *  settings page after a save so the topbar logo + theme refresh. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<BrandingContextValue>({
  branding: null,
  refresh: async () => {},
});

export function useBranding(): BrandingContextValue {
  return useContext(Ctx);
}

/**
 * Paint the four branding CSS variables onto :root.
 *  --color-primary, --color-primary-hover, --color-primary-foreground,
 *  --color-secondary
 */
function paint(branding: PublicBranding | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (branding && branding.isActive) {
    root.style.setProperty('--color-primary', branding.primaryColor);
    root.style.setProperty('--color-primary-hover', branding.primaryHoverColor);
    root.style.setProperty('--color-primary-foreground', branding.primaryForegroundColor);
    root.style.setProperty('--color-secondary', branding.secondaryColor);
  } else {
    // Wipe inline overrides so the defaults from tokens.css apply.
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-primary-hover');
    root.style.removeProperty('--color-primary-foreground');
    root.style.removeProperty('--color-secondary');
  }
}

interface ProviderProps {
  /** SSR-provided initial value — keeps the theme stable across the
   *  hydration boundary. Pass null when the user isn't authenticated. */
  initial: PublicBranding | null;
  children: ReactNode;
}

export function BrandingThemeProvider({ initial, children }: ProviderProps) {
  const [branding, setBranding] = useState<PublicBranding | null>(initial);

  // Repaint whenever the branding ref changes (initial mount + every
  // refresh + every settings.update event).
  useEffect(() => {
    paint(branding);
  }, [branding]);

  // Pull fresh branding on mount in case the SSR snapshot was stale
  // (cookie present but server fetch failed at SSR time, etc.).
  // Skipped when SSR already gave us a doc — we trust it.
  useEffect(() => {
    if (initial) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for the settings page's "branding-updated" custom event
  // and refresh in place. Lets the topbar logo flip the instant the
  // settings page saves without an actual route change.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<PublicBranding>).detail;
      if (detail) {
        setBranding(detail);
      } else {
        void refresh();
      }
    };
    window.addEventListener('branding-updated', onUpdate);
    return () => window.removeEventListener('branding-updated', onUpdate);
  }, []);

  async function refresh(): Promise<void> {
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const res = await fetch(`${base}/api/v1/settings/branding`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { success: boolean; data: PublicBranding };
      if (body.success) setBranding(body.data);
    } catch {
      // Non-fatal — theme keeps whatever it had.
    }
  }

  return <Ctx.Provider value={{ branding, refresh }}>{children}</Ctx.Provider>;
}

/**
 * Render an inline `<style>` block carrying the four branding CSS
 * variables. Used by the SSR layout to inject the theme into <head>
 * before the React tree hydrates — kills the flash-of-default that
 * would otherwise happen on first paint of authenticated routes.
 */
export function brandingStyleTag(branding: PublicBranding | null): string {
  if (!branding || !branding.isActive) return '';
  // Inline values are safe — they're all hex-validated by Zod on the
  // API side, so no characters need escaping. We still gate by the
  // same `#hex` regex defensively.
  const safe = (v: string) =>
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(v) ? v : '';
  const p = safe(branding.primaryColor);
  const ph = safe(branding.primaryHoverColor);
  const pf = safe(branding.primaryForegroundColor);
  const s = safe(branding.secondaryColor);
  if (!p) return '';
  return `:root{--color-primary:${p};--color-primary-hover:${ph};--color-primary-foreground:${pf};--color-secondary:${s};}`;
}
