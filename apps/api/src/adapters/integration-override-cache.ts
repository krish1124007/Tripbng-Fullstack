// Tiny process-local cache of admin-disabled integration codes.
//
// Lives in its own module so it can be imported by both:
//   - adapters/registry.ts (hot-path sync check from adapter getters)
//   - services/integration-status.service.ts (populates the cache from
//     the IntegrationOverride Mongo collection on a 30s tick)
//
// Splitting prevents the circular import that would otherwise form
// (service → registry → service).

import { IntegrationOverride } from '../models/IntegrationOverride.js';
import { logger } from '../config/logger.js';

const REFRESH_MS = 30_000;
let disabled = new Set<string>();
let timer: NodeJS.Timeout | null = null;

/** Sync check — used by adapter singleton getters before returning. */
export function isIntegrationOverrideDisabled(code: string): boolean {
  return disabled.has(code.toUpperCase());
}

/** Pull the latest set of disabled codes from Mongo. Best-effort —
 *  on failure, we keep the previous cache so a brief Mongo blip doesn't
 *  collapse every adapter. */
export async function refreshOverrideCache(): Promise<void> {
  try {
    const rows = await IntegrationOverride.find({ disabled: true }).select('code').lean();
    disabled = new Set(rows.map((r) => r.code.toUpperCase()));
  } catch (err) {
    logger.warn({ err }, 'integration-override: refresh failed, keeping previous cache');
  }
}

/** Start the periodic refresh. Called from src/index.ts after Mongo
 *  connects. Idempotent — calling twice resets the interval cleanly. */
export async function startOverrideCacheRefresh(): Promise<void> {
  await refreshOverrideCache();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void refreshOverrideCache();
  }, REFRESH_MS);
  // Don't hold the event loop open just for this timer.
  timer.unref?.();
}

export function stopOverrideCacheRefresh(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
