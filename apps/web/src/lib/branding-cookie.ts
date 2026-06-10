// Branding SSR snapshot — read by the root layout to paint the theme
// before React hydrates so authenticated routes don't flash the
// platform-default colours.
//
// The cookie is set by the API on successful login + every branding
// mutation. JSON-stringified PublicBranding, max ~600 bytes. Plain
// (non-HttpOnly) because it's purely cosmetic — no PII, no secret.

import { cookies } from 'next/headers';
import type { PublicBranding } from '@tripbng/shared';

export const BRANDING_COOKIE_NAME = 'tripbng_branding';

/**
 * Read the branding cookie set by the API (or null when absent /
 * malformed). Always safe to call inside a Server Component.
 */
export function readBrandingCookie(): PublicBranding | null {
  try {
    const c = cookies().get(BRANDING_COOKIE_NAME);
    if (!c?.value) return null;
    const parsed = JSON.parse(decodeURIComponent(c.value)) as PublicBranding;
    // Defensive — only return when the doc has the required shape.
    if (
      typeof parsed?.primaryColor !== 'string' ||
      typeof parsed?.secondaryColor !== 'string' ||
      typeof parsed?.isActive !== 'boolean'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
