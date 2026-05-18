// SeatSellerClient — real HTTP implementation against the SeatSeller v3
// API.
//
// Production code MUST NOT import this file directly outside factory.ts.
// The booking service depends on ISeatSellerClient; the factory picks
// real vs mock based on env (SEATSELLER_USE_MOCK).
//
// Operational rules baked in (CLAUDE.md §6.2):
//   - Native fetch (Node 20+); 185s default timeout (SeatSeller worst case
//     is 180s).
//   - OAuth token cached in Redis with TTL = expires_in - 300s; refreshed
//     on 401.
//   - Retries (2x exponential 200ms / 800ms) ONLY on idempotent reads —
//     never blockTicket / bookTicket / cancelTicket.
//   - Every call gets a traceId; full request/response logged at debug,
//     headers + status at info, errors with body at warn.
//   - SeatSeller error strings → typed errors via mapSeatSellerError.

import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import {
  OAuthError,
  SeatSellerError,
  TransportError,
  mapSeatSellerError,
} from './errors.js';
import type { ISeatSellerClient } from './client.interface.js';
import type {
  SeatSellerAvailableTrip,
  SeatSellerAvailableTripsRequest,
  SeatSellerBlockRequest,
  SeatSellerBlockResponse,
  SeatSellerBookResponse,
  SeatSellerBpDpDetails,
  SeatSellerBpDpDetailsRequest,
  SeatSellerBusCancellationInfoRequest,
  SeatSellerCancelRequest,
  SeatSellerCancelResponse,
  SeatSellerCancellationData,
  SeatSellerCancelledTinRef,
  SeatSellerCity,
  SeatSellerCityAlias,
  SeatSellerOauthToken,
  SeatSellerTicket,
  SeatSellerTripDetails,
  SeatSellerTripDetailsV2Request,
  SeatSellerUpdatedFare,
} from './types.js';

export interface SeatSellerClientConfig {
  baseUrl: string;
  oauthKey: string;
  oauthSecret: string;
  tokenUrl: string;
  /** Wall-clock timeout per request in ms. Default 185_000 (SeatSeller
   *  worst case is 180s). */
  requestTimeoutMs: number;
  /** Block-call timeout in ms — separate so we can cap blockTicket
   *  tighter than the 185s outer; default 60_000. */
  blockTimeoutMs: number;
  /** Redis key for the cached OAuth token. */
  oauthCacheKey: string;
}

const DEFAULT_RETRY_DELAYS_MS = [200, 800] as const;

/** Calls the read endpoints can safely retry. The booking lifecycle
 *  endpoints (block / book / cancel) are NEVER retried — see CLAUDE.md
 *  §6.2 and §0 Law 2. */
const IDEMPOTENT_ENDPOINTS = new Set([
  'getCities',
  'getAliases',
  'getAvailableTrips',
  'getTripDetails',
  'getTripDetailsV2',
  'getBpDpDetails',
  'getTicket',
  'checkBookedTicket',
  'getCancellationData',
  'busCancellationInfo',
]);

export class SeatSellerClient implements ISeatSellerClient {
  constructor(private readonly cfg: SeatSellerClientConfig) {}

  // ────────── Reference data ──────────

  async getCities(): Promise<SeatSellerCity[]> {
    return this.call<SeatSellerCity[]>({
      endpoint: 'getCities',
      method: 'GET',
      path: '/cities',
    });
  }

  async getAliases(): Promise<SeatSellerCityAlias[]> {
    return this.call<SeatSellerCityAlias[]>({
      endpoint: 'getAliases',
      method: 'GET',
      path: '/cities/aliases',
    });
  }

  // ────────── Search ──────────

  async getAvailableTrips(req: SeatSellerAvailableTripsRequest): Promise<SeatSellerAvailableTrip[]> {
    return this.call<SeatSellerAvailableTrip[]>({
      endpoint: 'getAvailableTrips',
      method: 'GET',
      path: '/trips',
      query: { source: req.source, destination: req.destination, doj: req.doj },
    });
  }

  // ────────── Trip detail (LIVE) ──────────

  async getTripDetails(tripId: string): Promise<SeatSellerTripDetails> {
    return this.call<SeatSellerTripDetails>({
      endpoint: 'getTripDetails',
      method: 'GET',
      path: `/trips/${encodeURIComponent(tripId)}`,
    });
  }

  async getTripDetailsV2(req: SeatSellerTripDetailsV2Request): Promise<SeatSellerTripDetails> {
    return this.call<SeatSellerTripDetails>({
      endpoint: 'getTripDetailsV2',
      method: 'POST',
      path: '/trips/details/v2',
      body: req,
    });
  }

  async getBpDpDetails(req: SeatSellerBpDpDetailsRequest): Promise<SeatSellerBpDpDetails> {
    return this.call<SeatSellerBpDpDetails>({
      endpoint: 'getBpDpDetails',
      method: 'GET',
      path: `/trips/${encodeURIComponent(req.tripId)}/bpdp`,
      query: req.bpId !== undefined ? { bpId: req.bpId } : undefined,
    });
  }

  // ────────── Booking lifecycle (NEVER retried) ──────────

  async blockTicket(req: SeatSellerBlockRequest): Promise<SeatSellerBlockResponse> {
    return this.call<SeatSellerBlockResponse>({
      endpoint: 'blockTicket',
      method: 'POST',
      path: '/bookings/block',
      body: req,
      timeoutMs: this.cfg.blockTimeoutMs,
    });
  }

  async getUpdatedFare(blockKey: string): Promise<SeatSellerUpdatedFare> {
    return this.call<SeatSellerUpdatedFare>({
      endpoint: 'getUpdatedFare',
      method: 'GET',
      path: `/bookings/${encodeURIComponent(blockKey)}/fare`,
    });
  }

  async bookTicket(blockKey: string): Promise<SeatSellerBookResponse> {
    return this.call<SeatSellerBookResponse>({
      endpoint: 'bookTicket',
      method: 'POST',
      path: `/bookings/${encodeURIComponent(blockKey)}/book`,
    });
  }

  async checkBookedTicket(blockKey: string): Promise<SeatSellerTicket | null> {
    try {
      return await this.call<SeatSellerTicket>({
        endpoint: 'checkBookedTicket',
        method: 'GET',
        path: `/bookings/${encodeURIComponent(blockKey)}/status`,
      });
    } catch (err) {
      // Block still open / not yet booked — SeatSeller surfaces this as
      // a 404. Return null instead of throwing so the booking service
      // can branch cleanly on "yes, eventually booked" vs "no, never
      // booked → refund wallet".
      if (err instanceof SeatSellerError && err.httpStatus === 404) return null;
      throw err;
    }
  }

  async getTicket(tin: string): Promise<SeatSellerTicket> {
    return this.call<SeatSellerTicket>({
      endpoint: 'getTicket',
      method: 'GET',
      path: `/tickets/${encodeURIComponent(tin)}`,
    });
  }

  async getCancellationData(tin: string): Promise<SeatSellerCancellationData> {
    return this.call<SeatSellerCancellationData>({
      endpoint: 'getCancellationData',
      method: 'GET',
      path: `/tickets/${encodeURIComponent(tin)}/cancellation`,
    });
  }

  async cancelTicket(req: SeatSellerCancelRequest): Promise<SeatSellerCancelResponse> {
    return this.call<SeatSellerCancelResponse>({
      endpoint: 'cancelTicket',
      method: 'POST',
      path: `/tickets/${encodeURIComponent(req.tin)}/cancel`,
      body: req.seatsToCancel ? { seatsToCancel: req.seatsToCancel } : {},
    });
  }

  async busCancellationInfo(
    req: SeatSellerBusCancellationInfoRequest,
  ): Promise<SeatSellerCancelledTinRef[]> {
    return this.call<SeatSellerCancelledTinRef[]>({
      endpoint: 'busCancellationInfo',
      method: 'GET',
      path: '/cancellations/bus',
      query: { from: req.from, to: req.to },
    });
  }

  // ────────── Internal HTTP machinery ──────────

  private async call<T>(args: {
    endpoint: string;
    method: 'GET' | 'POST';
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<T> {
    const traceId = randomUUID();
    const idempotent = IDEMPOTENT_ENDPOINTS.has(args.endpoint);
    const maxAttempts = idempotent ? DEFAULT_RETRY_DELAYS_MS.length + 1 : 1;

    let lastErr: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        const delay = DEFAULT_RETRY_DELAYS_MS[attempt - 1] ?? 0;
        await sleep(delay);
        logger.warn(
          { traceId, endpoint: args.endpoint, attempt, delay },
          'seatseller: retrying idempotent call',
        );
      }
      try {
        return await this.callOnce<T>(args, traceId);
      } catch (err) {
        lastErr = err;
        // Stop early on errors we've classified as definitive
        // (anything except transport / unclassified). Even idempotent
        // reads shouldn't retry e.g. NOT_FOUND.
        if (
          !(err instanceof TransportError) &&
          !(err instanceof SeatSellerError && err.code === 'UNKNOWN')
        ) {
          throw err;
        }
      }
    }
    throw lastErr;
  }

  private async callOnce<T>(
    args: {
      endpoint: string;
      method: 'GET' | 'POST';
      path: string;
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      timeoutMs?: number;
    },
    traceId: string,
  ): Promise<T> {
    const url = this.buildUrl(args.path, args.query);
    const timeoutMs = args.timeoutMs ?? this.cfg.requestTimeoutMs;
    const startedAt = Date.now();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: args.method,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-trace-id': traceId,
        },
        body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort = (err as Error).name === 'AbortError';
      logger.warn(
        { traceId, endpoint: args.endpoint, url, ms: Date.now() - startedAt, isAbort, err },
        'seatseller: transport failure',
      );
      throw new TransportError({
        upstream: isAbort ? `${args.endpoint} timed out after ${timeoutMs}ms` : (err as Error).message,
        cause: err,
        retryable: true,
      });
    }
    clearTimeout(timer);

    const ms = Date.now() - startedAt;
    const text = await res.text();

    if (res.status === 401) {
      // Token rejected — refresh once and let the caller's retry chain
      // pick it up (only fires on idempotent endpoints; non-idempotent
      // calls surface OAuthError immediately).
      logger.warn({ traceId, endpoint: args.endpoint, ms }, 'seatseller: 401 — refreshing token');
      await this.refreshAccessToken().catch((cause) => {
        throw new OAuthError({ httpStatus: 401, upstream: text, cause });
      });
      throw new TransportError({ upstream: 'token rejected, refreshed', httpStatus: 401, retryable: true });
    }

    logger.info({ traceId, endpoint: args.endpoint, status: res.status, ms }, 'seatseller: response');

    if (!res.ok) {
      logger.warn({ traceId, endpoint: args.endpoint, status: res.status, body: text.slice(0, 500) }, 'seatseller: error response');
      throw mapSeatSellerError(text || `HTTP ${res.status}`, { traceId, endpoint: args.endpoint }, {
        httpStatus: res.status,
      });
    }

    if (logger.isLevelEnabled('debug')) {
      logger.debug({ traceId, endpoint: args.endpoint, body: text.slice(0, 2000) }, 'seatseller: response body');
    }

    if (text.length === 0) {
      // Some endpoints return an empty body on success (e.g. cancel with
      // no items). T may still be `void`-shaped — caller's responsibility.
      return undefined as unknown as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new SeatSellerError('UNPARSEABLE', `Non-JSON response from ${args.endpoint}`, {
        upstream: text.slice(0, 500),
        context: { traceId, endpoint: args.endpoint },
        cause,
      });
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const url = new URL(path, this.cfg.baseUrl.endsWith('/') ? this.cfg.baseUrl : `${this.cfg.baseUrl}/`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  // ────────── OAuth ──────────

  private async getAccessToken(): Promise<string> {
    const cached = await redis.get(this.cfg.oauthCacheKey).catch(() => null);
    if (cached) return cached;
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(this.cfg.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.oauthKey,
          client_secret: this.cfg.oauthSecret,
        }).toString(),
      });
    } catch (cause) {
      throw new OAuthError({ cause });
    }
    const text = await res.text();
    if (!res.ok) {
      throw new OAuthError({ httpStatus: res.status, upstream: text });
    }
    let parsed: Partial<SeatSellerOauthToken & { access_token: string; expires_in: number; token_type: string }>;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new OAuthError({ upstream: text, cause });
    }
    const accessToken = parsed.accessToken ?? parsed.access_token;
    const expiresIn = parsed.expiresIn ?? parsed.expires_in;
    if (!accessToken || typeof expiresIn !== 'number') {
      throw new OAuthError({ upstream: text });
    }
    // Cache for expires_in - 300 (5 min headroom). Floor to >= 60.
    const ttlSec = Math.max(60, expiresIn - 300);
    await redis.set(this.cfg.oauthCacheKey, accessToken, 'EX', ttlSec);
    return accessToken;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
