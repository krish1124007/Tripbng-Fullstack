// Integration status registry — the source of truth for the admin
// Suppliers page.
//
// Three responsibilities:
//   1. CATALOG — describe every code-registered adapter (label, products,
//      docs link, vendor org). Static; lives at the top of this file.
//   2. STATE   — for each entry, compute (env-enabled, override-disabled,
//      effective-on, last-health, capabilities).
//   3. CACHE   — health probes are 30s-cached in Redis so the admin
//      page doesn't hammer vendors every refresh; the on-demand
//      "Test now" path force-refreshes.
//
// The override cache (used by registry.ts adapter getters) lives below
// in this same file — a single setInterval keeps a process-local Set of
// disabled codes refreshed every 30s.

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';
import { IntegrationOverride } from '../models/IntegrationOverride.js';
import {
  getAirIQAdapterIfConfigured,
  getEtravAdapterIfConfigured,
  getKafilaAdapterIfConfigured,
  getTboFlightAdapterIfConfigured,
} from '../adapters/registry.js';
import { refreshOverrideCache } from '../adapters/integration-override-cache.js';
import { invalidateSearchCache } from './search-cache.js';

// ────────── Catalog ──────────

export type ProductSlug =
  | 'FLIGHT'
  | 'HOTEL'
  | 'BUS'
  | 'HOLIDAY'
  | 'VISA'
  | 'INSURANCE';

export interface IntegrationCatalogEntry {
  /** Adapter code (matches SupplierAdapter.code). */
  code: string;
  /** Display name shown in the admin UI. */
  name: string;
  /** Vendor / org tagline. */
  vendor: string;
  products: ProductSlug[];
  /** Whether the integration can be toggled off via override. MOCK and
   *  SERIES are platform-internal and not toggleable. */
  toggleable: boolean;
  /** Doc link or readme path. Empty when nothing's public. */
  docs?: string;
}

const CATALOG: IntegrationCatalogEntry[] = [
  {
    code: 'KAFILA',
    name: 'Kafila V2',
    vendor: 'Kafila Hospitality',
    products: ['FLIGHT'],
    toggleable: true,
    docs: '/docs#kafila',
  },
  {
    code: 'AIRIQ',
    name: 'AirIQ FIT',
    vendor: 'AirIQ AAS v1.0',
    products: ['FLIGHT'],
    toggleable: true,
  },
  {
    code: 'ETRAV',
    name: 'eTrav',
    vendor: 'eTrav Technologies',
    products: ['FLIGHT'],
    toggleable: true,
  },
  {
    code: 'TBO',
    name: 'TBO',
    vendor: 'TekTravels',
    products: ['FLIGHT', 'HOTEL', 'HOLIDAY'],
    toggleable: true,
  },
  {
    code: 'SEATSELLER',
    name: 'SeatSeller',
    vendor: 'RedBus Partner',
    products: ['BUS'],
    toggleable: true,
  },
  {
    code: 'ASEGO',
    name: 'ASEGO',
    vendor: 'ASEGO B2B',
    products: ['INSURANCE'],
    toggleable: true,
  },
  {
    code: 'MOCK',
    name: 'Mock Airways',
    vendor: 'TripBng internal',
    products: ['FLIGHT'],
    toggleable: false,
  },
  {
    code: 'SERIES',
    name: 'Series fares',
    vendor: 'TripBng internal',
    products: ['FLIGHT'],
    toggleable: false,
  },
];

export function getIntegrationCatalog(): IntegrationCatalogEntry[] {
  return CATALOG;
}

// ────────── Env-enabled lookup ──────────

/** Returns whether the integration is enabled via env flag. Doesn't
 *  consult overrides — that's a separate axis. */
function isEnvEnabled(code: string): boolean {
  switch (code) {
    case 'KAFILA':
      return env.KAFILA_ENABLED;
    case 'AIRIQ':
      // AirIQ's flag is still string-based via process.env (older pattern).
      return process.env.AIRIQ_ENABLED === 'true';
    case 'ETRAV':
      return process.env.ETRAV_ENABLED === 'true';
    case 'TBO':
      return env.TBO_ENABLED;
    case 'SEATSELLER':
      return env.SEATSELLER_ENABLED;
    case 'ASEGO':
      return env.ASEGO_ENABLED;
    case 'MOCK':
      // Mock is on in non-prod.
      return env.NODE_ENV !== 'production';
    case 'SERIES':
      // Always on — internal series inventory adapter.
      return true;
    default:
      return false;
  }
}

// Override cache lives in adapters/integration-override-cache.ts so the
// registry's hot-path sync check + the service-side refresh both share
// the same in-memory Set without a circular import.

// ────────── Health probes (cached in Redis 30s) ──────────

const HEALTH_CACHE_KEY = (code: string) => `integration:health:${code.toLowerCase()}`;
const HEALTH_CACHE_TTL_SEC = 30;

export interface IntegrationHealthSnapshot {
  ok: boolean | null; // null = no probe run yet
  message?: string;
  latencyMs?: number;
  probedAt?: string;
}

async function readHealth(code: string): Promise<IntegrationHealthSnapshot> {
  try {
    const raw = await redis.get(HEALTH_CACHE_KEY(code));
    if (!raw) return { ok: null };
    return JSON.parse(raw) as IntegrationHealthSnapshot;
  } catch {
    return { ok: null };
  }
}

async function writeHealth(code: string, snap: IntegrationHealthSnapshot): Promise<void> {
  try {
    await redis.set(HEALTH_CACHE_KEY(code), JSON.stringify(snap), 'EX', HEALTH_CACHE_TTL_SEC);
  } catch (err) {
    logger.warn({ err, code }, 'integration-health: cache write failed');
  }
}

/** Force a fresh health probe for one code. Returns the snapshot AND
 *  persists it to the Redis cache so subsequent inventory reads pick
 *  it up. NOT all codes are probeable — some adapters don't expose a
 *  cheap health primitive yet, in which case we return ok:null with a
 *  descriptive message. */
export async function probeIntegrationHealth(
  code: string,
): Promise<IntegrationHealthSnapshot> {
  const startedAt = Date.now();
  const upper = code.toUpperCase();
  let result: IntegrationHealthSnapshot;

  try {
    switch (upper) {
      case 'KAFILA': {
        const adapter = getKafilaAdapterIfConfigured();
        if (!adapter) {
          result = { ok: null, message: 'Not configured (set KAFILA_ENABLED + creds)' };
          break;
        }
        const h = await adapter.healthCheck();
        result = {
          ok: h.ok,
          latencyMs: h.latencyMs ?? Date.now() - startedAt,
          message: h.message,
        };
        break;
      }
      case 'AIRIQ': {
        const adapter = getAirIQAdapterIfConfigured();
        if (!adapter) {
          result = { ok: null, message: 'Not configured (set AIRIQ_ENABLED + creds)' };
          break;
        }
        const h = await adapter.healthCheck();
        result = {
          ok: h.ok,
          latencyMs: h.latencyMs ?? Date.now() - startedAt,
          message: h.message,
        };
        break;
      }
      case 'ETRAV': {
        const adapter = getEtravAdapterIfConfigured();
        if (!adapter) {
          result = { ok: null, message: 'Not configured (set ETRAV_ENABLED + creds)' };
          break;
        }
        const h = await adapter.healthCheck();
        result = {
          ok: h.ok,
          latencyMs: h.latencyMs ?? Date.now() - startedAt,
          message: h.message,
        };
        break;
      }
      case 'TBO': {
        const adapter = getTboFlightAdapterIfConfigured();
        if (!adapter) {
          result = { ok: null, message: 'Not configured (set TBO_ENABLED + creds)' };
          break;
        }
        const h = await adapter.healthCheck();
        result = {
          ok: h.ok,
          latencyMs: h.latencyMs ?? Date.now() - startedAt,
          message: h.message,
        };
        break;
      }
      case 'SEATSELLER': {
        // SeatSeller doesn't have a `getAdapterIfConfigured` shim yet —
        // we surface the env state honestly and skip the live probe.
        // Real probe lands when we expose a getter from its registry.
        const ok = env.SEATSELLER_ENABLED && env.SEATSELLER_USE_MOCK === false;
        result = {
          ok: env.SEATSELLER_ENABLED ? true : null,
          message: env.SEATSELLER_ENABLED
            ? env.SEATSELLER_USE_MOCK
              ? 'Configured · mock client (no live probe)'
              : 'Configured · live (probe not yet wired)'
            : 'Disabled (set SEATSELLER_ENABLED)',
          latencyMs: Date.now() - startedAt,
        };
        // Suppress unused-var lint
        void ok;
        break;
      }
      case 'ASEGO': {
        const ok = env.ASEGO_ENABLED;
        result = {
          ok: ok ? true : null,
          message: ok
            ? 'Configured · live probe not yet wired'
            : 'Disabled (set ASEGO_ENABLED)',
          latencyMs: Date.now() - startedAt,
        };
        break;
      }
      case 'MOCK':
        result = {
          ok: env.NODE_ENV !== 'production',
          message:
            env.NODE_ENV === 'production'
              ? 'Disabled in production'
              : 'Always on (dev fallback)',
          latencyMs: Date.now() - startedAt,
        };
        break;
      case 'SERIES':
        result = {
          ok: true,
          message: 'Internal series inventory — always on',
          latencyMs: Date.now() - startedAt,
        };
        break;
      default:
        result = { ok: null, message: `Unknown integration code: ${code}` };
    }
  } catch (err) {
    result = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startedAt,
    };
  }

  result.probedAt = new Date().toISOString();
  await writeHealth(upper, result);
  return result;
}

// ────────── Inventory aggregator ──────────

export interface IntegrationStatus {
  code: string;
  name: string;
  vendor: string;
  products: ProductSlug[];
  toggleable: boolean;
  docs?: string;
  envEnabled: boolean;
  overrideDisabled: boolean;
  effective: 'ON' | 'OFF';
  /** Reason the integration is OFF, when relevant. Surfaced as a hint
   *  in the admin UI so the operator knows what to fix. */
  offReason?: string;
  health: IntegrationHealthSnapshot;
  override?: {
    note: string;
    updatedAt: string;
    updatedBy: string | null;
  };
}

/** Fetch the complete admin-side integration inventory. Health is
 *  read from the 30s Redis cache; pass force=true to refresh now. */
export async function getIntegrationStatuses(opts: {
  forceHealth?: boolean;
} = {}): Promise<IntegrationStatus[]> {
  const overrides = await IntegrationOverride.find({}).lean();
  const overrideByCode = new Map(overrides.map((o) => [o.code.toUpperCase(), o]));

  const out: IntegrationStatus[] = [];
  for (const entry of CATALOG) {
    const envEnabled = isEnvEnabled(entry.code);
    const ovr = overrideByCode.get(entry.code);
    const overrideDisabled = Boolean(ovr?.disabled);

    const effective: 'ON' | 'OFF' = envEnabled && !overrideDisabled ? 'ON' : 'OFF';
    let offReason: string | undefined;
    if (effective === 'OFF') {
      if (!envEnabled) offReason = 'Env flag is off';
      else if (overrideDisabled) offReason = ovr?.note?.trim() || 'Disabled by admin override';
    }

    const health = opts.forceHealth
      ? await probeIntegrationHealth(entry.code)
      : await readHealth(entry.code.toUpperCase());

    out.push({
      code: entry.code,
      name: entry.name,
      vendor: entry.vendor,
      products: entry.products,
      toggleable: entry.toggleable,
      docs: entry.docs,
      envEnabled,
      overrideDisabled,
      effective,
      offReason,
      health,
      override: ovr
        ? {
            note: ovr.note ?? '',
            updatedAt: ovr.updatedAt.toISOString(),
            updatedBy: ovr.updatedBy ? String(ovr.updatedBy) : null,
          }
        : undefined,
    });
  }
  return out;
}

// ────────── Boot priming ──────────

/** Fire one health probe per catalogued integration in the background.
 *  Called from src/index.ts on boot so the admin Suppliers page lands
 *  with real status data on the first visit instead of "No probe yet".
 *  Best-effort: failures are logged but don't block startup. */
export async function primeIntegrationHealthCache(): Promise<void> {
  const codes = CATALOG.map((e) => e.code);
  // Parallel, but each call is independently caught — a single vendor
  // outage shouldn't stop the others from priming.
  await Promise.allSettled(
    codes.map((code) =>
      probeIntegrationHealth(code).catch((err) => {
        logger.warn({ err, code }, 'integration-health: boot-prime probe failed');
      }),
    ),
  );
}

// ────────── Toggle ──────────

export async function setIntegrationOverride(args: {
  code: string;
  disabled: boolean;
  note?: string;
  userId: string;
}): Promise<void> {
  const entry = CATALOG.find((e) => e.code === args.code.toUpperCase());
  if (!entry) throw new Error(`Unknown integration code: ${args.code}`);
  if (!entry.toggleable) {
    throw new Error(
      `${entry.name} is a platform-internal adapter and cannot be toggled from the admin UI.`,
    );
  }
  await IntegrationOverride.findOneAndUpdate(
    { code: entry.code },
    {
      $set: {
        disabled: args.disabled,
        note: args.note ?? '',
        updatedBy: args.userId,
      },
    },
    { upsert: true, new: true },
  );
  // Refresh the in-memory cache immediately so the change takes effect
  // in this process without waiting for the next 30s tick.
  await refreshOverrideCache();

  // Drop cached search responses so the next search re-runs the fan-out with
  // the new supplier set. Without this, a search performed while the supplier
  // was OFF keeps being replayed for up to the cache TTL after it's turned back
  // ON — which presents as "re-enabling the supplier showed no new flights".
  // Toggles are global (cross-tenant), so flush every tenant's search cache.
  await invalidateSearchCache();
}
