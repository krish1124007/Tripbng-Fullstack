// RateService — Phase-4 implementation of spec §3.7 (rate selection at
// booking time). Resolves the applicable RateConfiguration for a given
// (agency, service, supplier, route) and computes the resulting markup.
//
// Module mapping
//   Schema-level rate cards exist for CREDIT / DI / CASH only. Agencies in
//   the other two modes (DISTRIBUTOR, SUB_AGENT) inherit:
//     * DISTRIBUTOR → CASH (spec §3.7: distributors price like CASH).
//     * SUB_AGENT   → CASH for now. The spec mentions an
//                     `Agency.effectiveRateModule` per-sub-agent override
//                     but that field doesn't exist yet — opening it is a
//                     small Phase-5 follow-up. CASH is the safer default
//                     because the spec also says "cash rates must be lower
//                     than credit/DI" (admin-enforced via UI warning).
//
// Resolution priority
//   Per spec: AGENCY-scope rows for the caller's agency win over GLOBAL.
//   Ties within a scope break on priority DESC. We do the scope sort in
//   memory after a single Mongo query — cheap (at most ~tens of matching
//   rows per agency).
//
// Cache
//   Resolved rate is cached in Redis for 60 s keyed on
//   (agencyId, service, supplier, route). Spec asks for this exact TTL.
//   Cache invalidation is implicit (next admin write to RateConfiguration
//   bumps the underlying data; cached resolutions go stale within the
//   60 s window). For instant-invalidation, admin endpoints can call
//   `clearRateCache(agencyId)`.

import { Money } from '@tripbng/shared';
import { Agency } from '../../models/Agency.js';
import {
  RateConfiguration,
  type RateConfigurationDoc,
  type RateModule,
  type RateService as RateServiceLine,
} from '../../models/RateConfiguration.js';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { AppError, type AgencyModule } from '@tripbng/shared';

export interface ResolveRateInput {
  tenantId: string;
  agencyId: string;
  service: RateServiceLine;
  /** Upstream adapter code (e.g. 'TBO', 'AIRIQ', 'TRIPJACK'). Optional — used
   *  for `appliesTo.supplierIds` filter. */
  supplierId?: string | null;
  /** Flight/bus only — { from, to } IATA/city codes for sector filtering. */
  route?: { from: string; to: string } | null;
  /** Flight only — IATA airline code (e.g. 'AI', '6E') for airline filter. */
  airline?: string | null;
  /** Base amount the markup applies to (paise). Drives TIERED markup
   *  resolution; PERCENT / ABSOLUTE ignore. */
  baseAmountPaise?: number | null;
}

export interface ResolveRateResult {
  /** The matched config — null when no rate applies (caller may fall back
   *  to zero-markup or refuse to book, per business policy). */
  config: RateConfigurationDoc | null;
  /** The resolved module (after DISTRIBUTOR/SUB_AGENT mapping). */
  resolvedModule: RateModule;
  /** Computed markup amount in paise. Zero when config is null. */
  markupPaise: number;
  /** True = served from the Redis cache. */
  fromCache: boolean;
}

interface CachedRate {
  configId: string | null;
  resolvedModule: RateModule;
  markupPaise: number;
}

const CACHE_TTL_SEC = 60;
const cacheKey = (input: ResolveRateInput): string => {
  const parts = [
    'rate',
    input.agencyId,
    input.service,
    input.supplierId ?? '*',
    input.route ? `${input.route.from}-${input.route.to}` : '*',
    input.airline ?? '*',
    input.baseAmountPaise ?? 0,
  ];
  return parts.join(':');
};

/**
 * Look up the applicable rate config and compute the markup. See file header
 * for the priority rules + caching behaviour.
 */
export async function resolveRate(input: ResolveRateInput): Promise<ResolveRateResult> {
  // 1. Resolve the module the rate card should come from.
  const resolvedModule = await mapAgencyModuleToRateModule(input.tenantId, input.agencyId);

  // 2. Cache lookup. Misses fall through to Mongo.
  const key = cacheKey(input);
  const cached = await redis.get(key).catch(() => null);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as CachedRate;
      // Re-hydrate `config` only if the caller needs it — typical callers
      // just want the markup number. Cheap to refetch on demand.
      const config = parsed.configId
        ? await RateConfiguration.findById(parsed.configId)
        : null;
      return {
        config,
        resolvedModule: parsed.resolvedModule,
        markupPaise: parsed.markupPaise,
        fromCache: true,
      };
    } catch (err) {
      // Cache entry malformed — log and fall through to a fresh lookup.
      logger.warn({ err, key }, 'rate-cache: malformed entry, refetching');
    }
  }

  // 3. Mongo scan — filter strictly, sort + tie-break in memory.
  const now = new Date();
  const candidates = await RateConfiguration.find({
    tenantId: input.tenantId,
    module: resolvedModule,
    service: input.service,
    isActive: true,
    validFrom: { $lte: now },
    $or: [{ validTo: null }, { validTo: { $gte: now } }],
    $and: [
      {
        $or: [
          { scope: 'AGENCY', agencyId: input.agencyId },
          { scope: 'GLOBAL' },
        ],
      },
    ],
  });

  const matching = candidates.filter((c) => matchesFilters(c, input));
  // Sort: AGENCY scope wins over GLOBAL; within scope, higher priority wins.
  matching.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === 'AGENCY' ? -1 : 1;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
  const config = matching[0] ?? null;

  // 4. Compute the markup.
  const markupPaise = config
    ? computeMarkup(config, input.baseAmountPaise ?? 0)
    : 0;

  // 5. Cache the result. Cache misses (no matching config) are also cached
  //    to avoid hot-path repeated misses during the 60 s window.
  await redis
    .set(
      key,
      JSON.stringify({
        configId: config ? String(config._id) : null,
        resolvedModule,
        markupPaise,
      } satisfies CachedRate),
      'EX',
      CACHE_TTL_SEC,
    )
    .catch((err) => {
      logger.warn({ err, key }, 'rate-cache: write failed (continuing)');
    });

  return { config, resolvedModule, markupPaise, fromCache: false };
}

/**
 * Invalidate every cached rate resolution for an agency. Call from the admin
 * RateConfiguration write paths so a config change is visible immediately.
 */
export async function clearRateCache(agencyId: string): Promise<void> {
  // Redis SCAN is the right tool here; `keys` would block. Pattern matches
  // every key prefixed with `rate:<agencyId>:`.
  const stream = redis.scanStream({ match: `rate:${agencyId}:*`, count: 200 });
  const toDelete: string[] = [];
  for await (const batch of stream) {
    toDelete.push(...(batch as string[]));
  }
  if (toDelete.length > 0) {
    await redis.del(...toDelete);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/** Maps the 5-mode Agency enum down to the 3-card RateConfiguration enum. */
async function mapAgencyModuleToRateModule(
  tenantId: string,
  agencyId: string,
): Promise<RateModule> {
  const agency = await Agency.findOne({ _id: agencyId, tenantId })
    .select('module')
    .lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');
  const m = (agency.module ?? 'CASH') as AgencyModule;
  if (m === 'CREDIT' || m === 'DI' || m === 'CASH') return m;
  // DISTRIBUTOR + SUB_AGENT → CASH per spec §3.7. (When per-sub-agent
  // effective-rate-module is added, swap this for that lookup.)
  return 'CASH';
}

interface AppliesToFilters {
  airlines?: string[];
  supplierIds?: string[];
  sectors?: Array<{ from: string; to: string }>;
}

/** All three `appliesTo` filters AND together; empty arrays mean "match all". */
function matchesFilters(config: RateConfigurationDoc, input: ResolveRateInput): boolean {
  // Mongoose's `InferSchemaType` flattens the nested subdoc into `{}` —
  // re-cast through our local shape to get usable property typing.
  const at = (config.appliesTo ?? {}) as AppliesToFilters;
  if (at.airlines && at.airlines.length > 0) {
    if (!input.airline || !at.airlines.includes(input.airline)) return false;
  }
  if (at.supplierIds && at.supplierIds.length > 0) {
    if (!input.supplierId || !at.supplierIds.includes(input.supplierId)) return false;
  }
  if (at.sectors && at.sectors.length > 0) {
    if (!input.route) return false;
    const matched = at.sectors.some(
      (s) => s.from === input.route!.from && s.to === input.route!.to,
    );
    if (!matched) return false;
  }
  return true;
}

function computeMarkup(config: RateConfigurationDoc, baseAmountPaise: number): number {
  if (config.markupType === 'PERCENT') {
    const base = Money.fromNumberPaise(baseAmountPaise);
    const bp = config.markupBasisPoints ?? 0;
    return Money.toNumberPaise(Money.percentBasisPoints(base, bp));
  }
  if (config.markupType === 'ABSOLUTE') {
    return config.markupAbsolutePaise ?? 0;
  }
  // TIERED: walk the tiers in ascending order (the schema doesn't enforce
  // order, so we sort defensively). First tier whose ceiling covers the
  // base amount wins.
  const tiers = [...(config.markupTiers ?? [])].sort(
    (a, b) => a.upToAmountPaise - b.upToAmountPaise,
  );
  const matched = tiers.find((t) => baseAmountPaise <= t.upToAmountPaise) ?? tiers.at(-1);
  if (!matched) return 0;
  const base = Money.fromNumberPaise(baseAmountPaise);
  return Money.toNumberPaise(Money.percentBasisPoints(base, matched.markupBasisPoints));
}
