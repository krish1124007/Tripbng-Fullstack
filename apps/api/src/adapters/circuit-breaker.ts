// Per-supplier circuit breaker with rolling-window error rate.
//
// Why hand-roll vs `opossum`: we already have logger + metrics setup, and
// the breaker behaviour we want (drop a supplier from fanout when error rate
// > 30% over 60s; reinclude after 60s closed-state) is 60 lines including
// the metrics surface. opossum is heavier than the value it adds.
//
// Wraps every provider call:
//   await breaker.exec('ETRAV', () => client.search(req))
//
// Three states (mirrors the canonical pattern):
//   CLOSED   — calls go through, errors counted into the window
//   OPEN     — fail-fast, no upstream call; auto-tries HALF_OPEN after cooldown
//   HALF_OPEN — single probe call; success → CLOSED, failure → OPEN
//
// Stats exposed via getStats() so the admin /supplier-health page can render.

import { logger } from '../config/logger.js';
import { captureMessage } from '../config/sentry.js';
import { EVENTS, track } from '../services/analytics.service.js';
import { enqueueAlert } from '../services/alerts/index.js';

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerStats {
  state: BreakerState;
  windowMs: number;
  totalCalls: number;
  failures: number;
  successes: number;
  errorRate: number; // 0..1
  lastFailureAt: Date | null;
  openedAt: Date | null;
  cooldownMs: number;
}

export interface BreakerOptions {
  /** Failure-rate window. Default 60s. */
  windowMs?: number;
  /** Minimum calls before the breaker can trip. Default 10 — protects from
   *  flapping when the very first call after a deploy fails. */
  volumeThreshold?: number;
  /** Trip threshold. 0..1. Default 0.30. */
  errorRateThreshold?: number;
  /** Cooldown before HALF_OPEN probe. Default 60s. */
  cooldownMs?: number;
  /** Hook for metric/alert side effects. */
  onStateChange?: (key: string, from: BreakerState, to: BreakerState) => void;
}

interface CallRecord {
  ok: boolean;
  at: number;
}

interface BreakerEntry {
  state: BreakerState;
  history: CallRecord[]; // bounded by windowMs trim
  openedAt: number | null;
  lastFailureAt: number | null;
}

export class CircuitBreaker {
  private readonly entries = new Map<string, BreakerEntry>();
  private readonly opts: Required<BreakerOptions>;

  constructor(opts: BreakerOptions = {}) {
    this.opts = {
      windowMs: opts.windowMs ?? 60_000,
      volumeThreshold: opts.volumeThreshold ?? 10,
      errorRateThreshold: opts.errorRateThreshold ?? 0.3,
      cooldownMs: opts.cooldownMs ?? 60_000,
      onStateChange: opts.onStateChange ?? (() => undefined),
    };
  }

  /**
   * Execute `fn` under the breaker. If OPEN, throws `BREAKER_OPEN` immediately.
   * Records success/failure into the rolling window; trips when error rate
   * crosses threshold over volumeThreshold calls.
   */
  async exec<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const e = this.entry(key);
    const now = Date.now();

    // OPEN → check cooldown.
    if (e.state === 'OPEN') {
      if (e.openedAt && now - e.openedAt >= this.opts.cooldownMs) {
        this.transition(key, e, 'HALF_OPEN');
      } else {
        const err = new Error(`circuit ${key} is OPEN`);
        (err as Error & { code: string }).code = 'BREAKER_OPEN';
        throw err;
      }
    }

    try {
      const out = await fn();
      this.record(key, e, true);
      if (e.state === 'HALF_OPEN') this.transition(key, e, 'CLOSED');
      return out;
    } catch (err) {
      this.record(key, e, false);
      if (e.state === 'HALF_OPEN') this.transition(key, e, 'OPEN');
      else if (this.shouldTrip(e)) this.transition(key, e, 'OPEN');
      throw err;
    }
  }

  /** Read-only stats — used by the admin supplier-health page. */
  getStats(key: string): BreakerStats {
    const e = this.entry(key);
    this.trim(e);
    const total = e.history.length;
    const failures = e.history.filter((h) => !h.ok).length;
    const successes = total - failures;
    return {
      state: e.state,
      windowMs: this.opts.windowMs,
      totalCalls: total,
      failures,
      successes,
      errorRate: total === 0 ? 0 : failures / total,
      lastFailureAt: e.lastFailureAt ? new Date(e.lastFailureAt) : null,
      openedAt: e.openedAt ? new Date(e.openedAt) : null,
      cooldownMs: this.opts.cooldownMs,
    };
  }

  /** All known keys + their stats. Used by the registry to tell fanout which
   *  suppliers to skip on the current request. */
  getAllStats(): Record<string, BreakerStats> {
    const out: Record<string, BreakerStats> = {};
    for (const key of this.entries.keys()) out[key] = this.getStats(key);
    return out;
  }

  /** Hard reset — used by ops + tests. */
  reset(key: string): void {
    this.entries.delete(key);
  }

  // ────────── internals ──────────

  private entry(key: string): BreakerEntry {
    let e = this.entries.get(key);
    if (!e) {
      e = { state: 'CLOSED', history: [], openedAt: null, lastFailureAt: null };
      this.entries.set(key, e);
    }
    return e;
  }

  private record(key: string, e: BreakerEntry, ok: boolean): void {
    const now = Date.now();
    e.history.push({ ok, at: now });
    if (!ok) e.lastFailureAt = now;
    this.trim(e);
  }

  private trim(e: BreakerEntry): void {
    const cutoff = Date.now() - this.opts.windowMs;
    while (e.history.length && e.history[0]!.at < cutoff) e.history.shift();
  }

  private shouldTrip(e: BreakerEntry): boolean {
    this.trim(e);
    const total = e.history.length;
    if (total < this.opts.volumeThreshold) return false;
    const failures = e.history.filter((h) => !h.ok).length;
    return failures / total >= this.opts.errorRateThreshold;
  }

  private transition(key: string, e: BreakerEntry, to: BreakerState): void {
    const from = e.state;
    if (from === to) return;
    e.state = to;
    e.openedAt = to === 'OPEN' ? Date.now() : null;
    if (to === 'CLOSED') e.history = [];
    logger.warn({ key, from, to }, 'circuit-breaker state change');
    if (to === 'OPEN') {
      captureMessage('circuit-breaker-tripped', 'warn', {
        tags: { key, from, to },
      });
      // Surface to PostHog so the operations dashboard can show breaker-trip
      // events alongside funnel data — distinctId is `system:breaker` because
      // there's no actor: this is platform behaviour.
      track({
        event: EVENTS.SUPPLIER_BREAKER_TRIPPED,
        distinctId: 'system:breaker',
        properties: { supplier: key, from, to },
      });

      // Ops alert — read live stats so the email surfaces the actual error
      // rate, not just the threshold. Fire-and-forget; failure to alert ops
      // must not break the search fanout.
      const stats = this.getStats(key);
      void enqueueAlert(
        {
          event: 'CIRCUIT_BREAKER_TRIPPED',
          vars: {
            supplier: key,
            errorRate: stats.errorRate,
            windowSec: Math.round(stats.windowMs / 1000),
          },
        },
        [{ kind: 'ops' }],
        {
          // Ops alerts are tenant-agnostic; the in-app channel is disabled
          // for this event so a placeholder tenant id is fine. Use a fixed
          // sentinel string so the dispatcher doesn't trip up on Mongo
          // ObjectId validation in the in-app path (which we don't take here
          // anyway because the router restricts CIRCUIT_BREAKER_TRIPPED to
          // email only).
          tenantId: '000000000000000000000000',
          correlationKey: `breaker:${key}`,
        },
      );
    }
    this.opts.onStateChange(key, from, to);
  }
}

/** Global singleton — used for supplier search fanout. */
export const supplierBreaker = new CircuitBreaker({
  windowMs: 60_000,
  volumeThreshold: 10,
  errorRateThreshold: 0.3,
  cooldownMs: 60_000,
});
