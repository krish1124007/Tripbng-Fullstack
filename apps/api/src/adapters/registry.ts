import { logger } from '../config/logger.js';
import { Supplier } from '../models/Supplier.js';
import { isIntegrationOverrideDisabled } from './integration-override-cache.js';
import { SeriesAdapter } from './series.adapter.js';
import { MockAdapter } from './mock.adapter.js';
import { EtravAdapter } from './etrav/etrav.adapter.js';
import { readEtravConfigFromEnv } from './etrav/client.js';
import { AirIQAdapter } from './airiq/airiq.adapter.js';
import { readAirIQConfigFromEnv } from './airiq/client.js';
import { TboFlightAdapter } from './tbo-flight/tbo-flight.adapter.js';
import { KafilaAdapter } from './kafila/kafila.adapter.js';
import { readKafilaConfigFromEnv } from './kafila/client.js';
import { env } from '../config/env.js';
import {
  SupplierAdapterError,
  type NormalizedFareOption,
  type NormalizedSearchRequest,
  type SupplierAdapter,
} from './types.js';
import { supplierBreaker } from './circuit-breaker.js';

// Module-level singleton — eTrav credentials never change at runtime, so build
// the adapter once and reuse. Returns null if env vars aren't set or the flag
// is off, in which case eTrav is silently skipped from the adapter set.
let etravSingleton: EtravAdapter | null | undefined;
function getEtravAdapter(): EtravAdapter | null {
  // Admin runtime override always wins — checked on every call so the
  // ops switch from /suppliers takes effect within the cache refresh
  // window (~30s) without a process restart.
  if (isIntegrationOverrideDisabled('ETRAV')) return null;
  if (etravSingleton !== undefined) return etravSingleton;
  if (process.env.ETRAV_ENABLED !== 'true') {
    etravSingleton = null;
    return null;
  }
  const cfg = readEtravConfigFromEnv();
  if (!cfg) {
    logger.warn('ETRAV_ENABLED=true but ETRAV_* env vars are missing — skipping eTrav adapter');
    etravSingleton = null;
    return null;
  }
  etravSingleton = new EtravAdapter(cfg);
  logger.info({ baseUrl: cfg.baseUrl }, 'eTrav adapter initialised');
  return etravSingleton;
}

// Same lazy-singleton pattern for AirIQ. Search-only first cut; booking lands later.
let airiqSingleton: AirIQAdapter | null | undefined;
function getAirIQAdapter(): AirIQAdapter | null {
  if (isIntegrationOverrideDisabled('AIRIQ')) return null;
  if (airiqSingleton !== undefined) return airiqSingleton;
  if (process.env.AIRIQ_ENABLED !== 'true') {
    airiqSingleton = null;
    return null;
  }
  const cfg = readAirIQConfigFromEnv();
  if (!cfg) {
    logger.warn('AIRIQ_ENABLED=true but AIRIQ_* env vars are missing — skipping AirIQ adapter');
    airiqSingleton = null;
    return null;
  }
  airiqSingleton = new AirIQAdapter(cfg);
  logger.info({ baseUrl: cfg.baseUrl }, 'AirIQ adapter initialised');
  return airiqSingleton;
}

// TBO flight adapter — auth + audit + circuit-breaker reuse the
// infrastructure built for the hotel TBO integration. Same TBO_ENABLED gate;
// flight-specific tunables (TBO_FLIGHT_BASE, search timeout, priority) live
// in env.ts. When TBO_ENABLED=false the adapter is silently skipped, exactly
// like eTrav/AirIQ.
let tboFlightSingleton: TboFlightAdapter | null | undefined;
function getTboFlightAdapter(): TboFlightAdapter | null {
  if (isIntegrationOverrideDisabled('TBO')) return null;
  if (tboFlightSingleton !== undefined) return tboFlightSingleton;
  if (!env.TBO_ENABLED) {
    tboFlightSingleton = null;
    return null;
  }
  if (!env.TBO_USERNAME || !env.TBO_PASSWORD || !env.TBO_END_USER_IP) {
    logger.warn(
      'TBO_ENABLED=true but credentials/IP missing — skipping TBO flight adapter',
    );
    tboFlightSingleton = null;
    return null;
  }
  tboFlightSingleton = new TboFlightAdapter();
  logger.info({ host: env.TBO_FLIGHT_BASE }, 'TBO flight adapter initialised');
  return tboFlightSingleton;
}

// Kafila V2 — Phase 1 ships health-check only, no search capability yet.
// We register the singleton so `/providers/kafila/health` works and the
// adapterForCode() switch resolves; fan-out search skips it because
// `capabilities` is empty until Phase 2.
let kafilaSingleton: KafilaAdapter | null | undefined;
function getKafilaAdapter(): KafilaAdapter | null {
  if (isIntegrationOverrideDisabled('KAFILA')) return null;
  if (kafilaSingleton !== undefined) return kafilaSingleton;
  const cfg = readKafilaConfigFromEnv();
  if (!cfg) {
    kafilaSingleton = null;
    return null;
  }
  kafilaSingleton = new KafilaAdapter(cfg);
  logger.info({ baseUrl: cfg.baseUrl }, 'Kafila adapter initialised');
  return kafilaSingleton;
}

// Build the per-request adapter set. Always includes the SeriesAdapter for the tenant; adds
// MockAdapter in non-production for demo data; conditionally adds EtravAdapter when the
// ETRAV_ENABLED flag is set; loops over enabled DB-configured suppliers (Phase 4 ships only
// the Mock and Series adapters wired; TripJack-style adapters land here once their classes
// exist).
export async function buildSearchAdapters(tenantId: string): Promise<SupplierAdapter[]> {
  const adapters: SupplierAdapter[] = [new SeriesAdapter(tenantId)];

  if (process.env.NODE_ENV !== 'production' && !isIntegrationOverrideDisabled('MOCK')) {
    adapters.push(new MockAdapter());
  }

  const etrav = getEtravAdapter();
  if (etrav) adapters.push(etrav);

  const airiq = getAirIQAdapter();
  if (airiq) adapters.push(airiq);

  const tboFlight = getTboFlightAdapter();
  if (tboFlight) adapters.push(tboFlight);

  // Kafila is registered but only joins fan-out search once Phase 2 lands
  // (capabilities=[] gates it out for now — the buildSearchAdapters caller
  // doesn't filter on capability, so we skip explicitly here).
  const kafila = getKafilaAdapter();
  if (kafila && kafila.capabilities.includes('SEARCH')) adapters.push(kafila);

  // Future: load adapters by supplier code. Each Supplier row maps to a class instance.
  // For now we only know about MOCK + SERIES + ETRAV + AIRIQ + TBO + KAFILA.
  const enabled = await Supplier.find({ tenantId, status: 'ACTIVE' }).lean();
  for (const s of enabled) {
    // Skip the ones we already injected.
    if (
      s.code === 'MOCK' ||
      s.code === 'SERIES' ||
      s.code === 'ETRAV' ||
      s.code === 'AIRIQ' ||
      s.code === 'TBO' ||
      s.code === 'KAFILA'
    )
      continue;
    // Real adapters wire here once their class exists. Logging the gap is more useful
    // than silently dropping the supplier.
    logger.warn({ supplierCode: s.code }, 'no adapter implementation for supplier — skipping');
  }

  return adapters;
}

// Stamped onto each option so downstream pricing/token-encoding knows which supplier
// produced it — `option.source` (SERIES/LCC/FSC/API) is inventory shape, not supplier identity.
export type FanoutFareOption = NormalizedFareOption & { supplierCode: string };

export interface SearchFanoutResult {
  options: FanoutFareOption[];
  errors: { supplierCode: string; code: string; message: string }[];
}

// Hard ceiling on how long any single supplier may take before the fanout
// gives up on it. Each adapter ALSO has its own (longer) per-call timeout
// (15–30s), but Promise.allSettled waits for the slowest — so without this
// deadline one unreachable supplier (e.g. a down sandbox) drags every search
// to ~30s and the flights API looks "unresponsive". This caps total search
// latency to ~FANOUT_DEADLINE_MS regardless of supplier health. Override with
// SEARCH_FANOUT_TIMEOUT_MS.
const FANOUT_DEADLINE_MS = Number(process.env.SEARCH_FANOUT_TIMEOUT_MS) || 12_000;

// Race a supplier call against the fanout deadline. On deadline, reject with a
// TIMEOUT-coded error so the caller surfaces it like any other supplier failure.
// The underlying call keeps running in the background only long enough for the
// breaker to record its real outcome (so breaker stats stay accurate).
function withFanoutDeadline<T>(code: string, call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new SupplierAdapterError(
        'TIMEOUT',
        `${code} exceeded fanout deadline of ${FANOUT_DEADLINE_MS}ms`,
        code,
      );
      reject(err);
    }, FANOUT_DEADLINE_MS);
    timer.unref?.();
    call.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Fan-out search across all adapters with per-call timeouts. Whichever adapters finish
// in time contribute their results; the rest are surfaced as errors. Spec §7.3.
//
// Each call is wrapped in the per-supplier circuit breaker — when a supplier
// trips OPEN (>30% errors over 60s), it's skipped immediately on subsequent
// calls (no upstream hit) and surfaced as a `BREAKER_OPEN` error instead of
// dragging the whole fanout to its timeout floor — plus the fanout deadline
// above as a hard backstop so a single hung supplier can't stall the response.
export async function fanoutSearch(
  adapters: readonly SupplierAdapter[],
  req: NormalizedSearchRequest,
): Promise<SearchFanoutResult> {
  const settled = await Promise.allSettled(
    adapters.map((a) =>
      withFanoutDeadline(
        a.code,
        supplierBreaker.exec(a.code, () => a.search(req)),
      ).then((r) => ({ supplier: a.code, options: r.options })),
    ),
  );

  const out: SearchFanoutResult = { options: [], errors: [] };
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]!;
    const adapter = adapters[i]!;
    if (s.status === 'fulfilled') {
      for (const opt of s.value.options) {
        out.options.push({ ...opt, supplierCode: adapter.code });
      }
    } else {
      const reason = s.reason as Error | SupplierAdapterError;
      const code =
        (reason as { code?: string }).code === 'BREAKER_OPEN'
          ? 'BREAKER_OPEN'
          : reason instanceof SupplierAdapterError
            ? reason.code
            : 'UPSTREAM';
      out.errors.push({
        supplierCode: adapter.code,
        code,
        message: reason.message ?? 'unknown error',
      });
    }
  }
  return out;
}

// Map a supplier code to a per-tenant adapter instance for hold/ticket/cancel paths.
export function adapterForCode(code: string, tenantId: string): SupplierAdapter {
  switch (code) {
    case 'SERIES':
      return new SeriesAdapter(tenantId);
    case 'MOCK':
      return new MockAdapter();
    case 'ETRAV': {
      const etrav = getEtravAdapter();
      if (!etrav) {
        throw new SupplierAdapterError(
          'NOT_FOUND',
          'eTrav adapter not configured (set ETRAV_ENABLED=true and ETRAV_* env vars)',
          code,
        );
      }
      return etrav;
    }
    case 'AIRIQ': {
      const airiq = getAirIQAdapter();
      if (!airiq) {
        throw new SupplierAdapterError(
          'NOT_FOUND',
          'AirIQ adapter not configured (set AIRIQ_ENABLED=true and AIRIQ_* env vars)',
          code,
        );
      }
      return airiq;
    }
    case 'TBO': {
      const tbo = getTboFlightAdapter();
      if (!tbo) {
        throw new SupplierAdapterError(
          'NOT_FOUND',
          'TBO flight adapter not configured (set TBO_ENABLED=true and TBO_* env vars)',
          code,
        );
      }
      return tbo;
    }
    case 'KAFILA': {
      const kafila = getKafilaAdapter();
      if (!kafila) {
        throw new SupplierAdapterError(
          'NOT_FOUND',
          'Kafila adapter not configured (set KAFILA_ENABLED=true and KAFILA_USER_ID / KAFILA_API_KEY / KAFILA_API_SECRET)',
          code,
        );
      }
      return kafila;
    }
    default:
      throw new SupplierAdapterError('NOT_FOUND', `no adapter for code ${code}`, code);
  }
}

/** Direct access to the EtravAdapter singleton for routes that need its
 *  extra methods (fareRule, reprice). Returns null if not configured. */
export function getEtravAdapterIfConfigured(): EtravAdapter | null {
  return getEtravAdapter();
}

/** Same shim for the TBO flight adapter — exposes the singleton so the
 *  /flights/farerule (and later /reprice) route can call its extra
 *  methods. Returns null when TBO_ENABLED=false or creds are missing. */
export function getTboFlightAdapterIfConfigured(): TboFlightAdapter | null {
  return getTboFlightAdapter();
}

/** AirIQ singleton exposure — used by the admin Suppliers / Integrations
 *  page to drive on-demand health probes. Returns null when AIRIQ_ENABLED
 *  is off, the env vars are missing, or an admin override has disabled it. */
export function getAirIQAdapterIfConfigured(): AirIQAdapter | null {
  return getAirIQAdapter();
}

/** Kafila singleton exposure — Phase 1's /providers/kafila/health route
 *  uses this to call the adapter's healthCheck() directly. Returns null
 *  when KAFILA_ENABLED=false or creds are missing. */
export function getKafilaAdapterIfConfigured(): KafilaAdapter | null {
  return getKafilaAdapter();
}
