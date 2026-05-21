// Pure helper extracted from branding-theme-provider.tsx — the latter
// is a 'use client' module, so its named exports are wrapped as
// client-reference proxies when imported by a Server Component (like
// `app/layout.tsx`). Calling that proxy as a function throws
// "(0 , …brandingStyleTag) is not a function" at request time.
//
// Keeping this helper in a separate file *without* the 'use client'
// pragma means both Server and Client components can import it
// directly as a plain function. The provider re-exports it so the
// existing client-side import sites keep working.

import type { PublicBranding } from '@tripbng/shared';

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
  const safe = (v: string): string =>
    /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6,8})$/.test(v) ? v : '';
  const p = safe(branding.primaryColor);
  const ph = safe(branding.primaryHoverColor);
  const pf = safe(branding.primaryForegroundColor);
  const s = safe(branding.secondaryColor);
  if (!p) return '';
  return `:root{--color-primary:${p};--color-primary-hover:${ph};--color-primary-foreground:${pf};--color-secondary:${s};}`;
}
