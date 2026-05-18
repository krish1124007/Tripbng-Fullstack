// AirIQ token manager.
//
// AirIQ tokens are issued by /Login and expire at end-of-day IST (§2.2). We
// cache one token per process keyed implicitly by the AirIQClient instance
// (each instance has fixed creds); concurrent callers share a single in-flight
// /Login. Redis caching can be layered in once we have multiple API instances —
// the current adapter set keeps it process-local to stay zero-dep on Redis for
// the search-only first cut.

import { logger } from '../../config/logger.js';
import type { AirIQClient } from './client.js';
import { secondsUntilEndOfDayIST } from './utils.js';

interface CachedToken {
  token: string;
  /** Absolute epoch ms when this token must be refreshed. */
  expiresAtMs: number;
}

export class AirIQTokenManager {
  private cached: CachedToken | null = null;
  /** Promise of an in-flight /Login — coalesces concurrent callers. */
  private inflight: Promise<string> | null = null;

  constructor(private readonly client: AirIQClient) {}

  /** Returns a cached token if fresh, else triggers (or joins) a /Login. */
  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs > now) {
      return this.cached.token;
    }
    return this.refresh();
  }

  /** Force-refresh — used by AirIQAdapter on the "token timed out" retry path. */
  async forceRefresh(): Promise<string> {
    this.cached = null;
    return this.refresh();
  }

  invalidate(): void {
    this.cached = null;
  }

  private refresh(): Promise<string> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const res = await this.client.login();
        const ttlSeconds = Math.max(60, secondsUntilEndOfDayIST());
        this.cached = {
          token: res.Token,
          expiresAtMs: Date.now() + ttlSeconds * 1000,
        };
        logger.info(
          { supplier: 'AIRIQ', ttlSeconds, sequenceId: res.Status.SequenceID },
          'airiq token refreshed',
        );
        return res.Token;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}
