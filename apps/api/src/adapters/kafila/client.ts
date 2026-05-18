// KafilaClient — Phase 1 HTTP layer.
//
// Responsibilities for this slice:
//   1. POST /api/auth/login → JWT
//   2. Cache the JWT in Redis (KAFILA_JWT_CACHE_KEY) with TTL =
//      KAFILA_JWT_TTL_SECONDS (defaults 27_000s / 7h 30min). Actual token
//      is 8h — the 30-min safety margin guarantees refresh before expiry.
//   3. Process-local single-flight: concurrent callers join one in-flight
//      /api/auth/login. Without this, a cold start fans out N parallel
//      logins and Kafila rate-limits us.
//   4. Persist every wire call to KafilaApiLog (PII-redacted) so vendor
//      support tickets can attach the trail.
//   5. Surface failures as KafilaError (extends SupplierAdapterError) so
//      the registry's circuit breaker + fan-out handle Kafila uniformly
//      with other suppliers.
//
// Search / pricing / booking methods land in subsequent phases — they
// reuse `withToken()` to inject the cached JWT into per-request bodies
// (Kafila puts the token in `header.userToken`, not as Authorization
// header — confirmed via Postman).

import { randomUUID } from 'node:crypto';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { KafilaApiLog } from '../../models/KafilaApiLog.js';
import {
  KflLoginResponse,
  KflSearchResponse,
  KflPricingResponse,
  KflSSRResponse,
  KflSeatMapResponse,
  KflBookingResponse,
  type KflLoginRequestT,
  type KflSearchRequestT,
  type KflSearchResponseT,
  type KflPricingRequestT,
  type KflPricingResponseT,
  type KflSSRResponseT,
  type KflSeatMapResponseT,
  type KflCreatePnrRequestT,
  type KflBookingResponseT,
} from './types.js';
import { KafilaError, mapKafilaVendorError, transportError } from './errors.js';

export interface KafilaClientConfig {
  baseUrl: string;
  userId: string;
  apiKey: string;
  apiSecret: string;
  companyId?: string;
  credentialType: 'TEST' | 'LIVE';
  salesChannel: 'API' | 'B2B' | 'B2C';
  timeoutMs: number;
  jwtCacheKey: string;
  jwtTtlSeconds: number;
}

interface CallArgs {
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Skip the auth gate (only for /api/auth/login itself). */
  unauthenticated?: boolean;
  /** Per-call timeout override; defaults to config.timeoutMs. */
  timeoutMs?: number;
  /** Correlation context for the audit log row. */
  correlationId?: string;
  bookingId?: string;
  /** Internal flag set on the 401-retry path so we only refresh+retry
   *  once. External callers never set this. */
  _retried?: boolean;
}

/** Fields stripped from request bodies before persisting to KafilaApiLog.
 *  Kafila echoes apiKey/apiSecret/userToken inside the login + many other
 *  bodies; we never want those landing in Mongo plaintext. */
const REDACTED_REQUEST_FIELDS = new Set([
  'apiKey',
  'apiSecret',
  'userToken',
  'password',
]);

export class KafilaClient {
  /** Process-local single-flight for /api/auth/login. Concurrent callers
   *  attach to this promise; the first to miss the Redis cache populates
   *  it for everyone. Cleared in `finally`. */
  private loginInflight: Promise<string> | null = null;

  constructor(private readonly cfg: KafilaClientConfig) {}

  // ────────── Public surface (Phase 1) ──────────

  /** Force-fetch a fresh JWT regardless of cache state. Used by the
   *  health endpoint to prove end-to-end auth works. */
  async login(): Promise<string> {
    return this.refreshToken();
  }

  /** Return a usable JWT — cache hit if fresh, else /api/auth/login.
   *  Phase 2+ adapter methods call this before every wire call. */
  async getToken(): Promise<string> {
    const cached = await redis.get(this.cfg.jwtCacheKey).catch(() => null);
    if (cached) return cached;
    return this.refreshToken();
  }

  /** Generic wire call. Injects `Authorization: Bearer <jwt>` unless
   *  `args.unauthenticated` is true (only login uses that). On 401,
   *  refreshes the token and retries exactly once — handles the edge
   *  case where the cached JWT happened to expire mid-flight or
   *  Kafila rotated keys server-side. */
  async call<T>(args: CallArgs, parse: (raw: unknown) => T): Promise<T> {
    const url = this.buildUrl(args.path);
    const timeoutMs = args.timeoutMs ?? this.cfg.timeoutMs;
    const correlationId = args.correlationId ?? randomUUID();
    const startedAt = Date.now();

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-correlation-id': correlationId,
    };
    if (!args.unauthenticated) {
      // Bearer-token injection. We DON'T catch errors from getToken()
      // here — if login fails the whole call should fail loud. Audit
      // logging happens inside refreshToken() via its own call() trip.
      const jwt = await this.getToken();
      headers.authorization = `Bearer ${jwt}`;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    let res: Response;
    let text = '';
    let httpStatus: number | undefined;
    try {
      try {
        res = await fetch(url, {
          method: args.method,
          headers,
          body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
          signal: ctrl.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const transport = transportError(args.operation, err as Error);
        await this.persistLog({
          ...args,
          correlationId,
          httpStatus: undefined,
          response: null,
          responseHeaders: null,
          durationMs: Date.now() - startedAt,
          errorCode: transport.code,
          errorMessage: transport.message,
        });
        throw transport;
      }
      clearTimeout(timer);
      httpStatus = res.status;
      text = await res.text();
    } catch (err) {
      throw err;
    }

    const durationMs = Date.now() - startedAt;
    const responseHeaders = Object.fromEntries(res.headers.entries());

    // Parse JSON — even error responses from Kafila are JSON envelopes.
    let parsedBody: unknown;
    try {
      parsedBody = text.length > 0 ? JSON.parse(text) : null;
    } catch (err) {
      const parseErr = new KafilaError(
        'UPSTREAM',
        `Kafila ${args.operation} returned non-JSON response`,
        undefined,
        httpStatus,
        text.slice(0, 200),
      );
      await this.persistLog({
        ...args,
        correlationId,
        httpStatus,
        response: { _raw: text.slice(0, 2000) },
        responseHeaders,
        durationMs,
        errorCode: parseErr.code,
        errorMessage: parseErr.message,
      });
      throw parseErr;
    }

    // 401 + cached JWT path: refresh and retry exactly once. Skip on the
    // login call itself (its own auth failure means bad creds, not a
    // stale token — retrying won't help). Skip on already-retried calls.
    if (httpStatus === 401 && !args.unauthenticated && !args._retried) {
      logger.warn(
        { supplier: 'KAFILA', operation: args.operation, correlationId },
        'kafila 401 — refreshing token and retrying once',
      );
      await redis.del(this.cfg.jwtCacheKey).catch(() => undefined);
      await this.refreshToken();
      return this.call({ ...args, _retried: true }, parse);
    }

    // HTTP-level failure (5xx, 4xx with no envelope).
    if (!res.ok) {
      const vendorStatus =
        parsedBody && typeof parsedBody === 'object' && 'status' in (parsedBody as Record<string, unknown>)
          ? Number((parsedBody as Record<string, unknown>).status)
          : undefined;
      const vendorMsg =
        parsedBody && typeof parsedBody === 'object' && 'message' in (parsedBody as Record<string, unknown>)
          ? String((parsedBody as Record<string, unknown>).message ?? '')
          : `HTTP ${res.status}`;
      const mapped = mapKafilaVendorError(args.operation, vendorStatus ?? 0, vendorMsg, res.status);
      await this.persistLog({
        ...args,
        correlationId,
        httpStatus,
        response: parsedBody,
        responseHeaders,
        durationMs,
        kafilaStatus: vendorStatus,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });
      throw mapped;
    }

    // 2xx with envelope. Kafila is inconsistent across endpoints:
    //   - /api/auth/login → `{ token: "..." }` (NO success/status fields)
    //   - search / pricing / SSR / seat-map → `{ success: true, status: 200, data: {...} }`
    //     (verified live; the spec's `status: 1` was outdated)
    //   - booking → `{ data: { Status: "...", BookingInfo: {...} } }`
    //     (no top-level success either)
    //
    // Success signal precedence (most authoritative first):
    //   1. `success === false` → definitely failed
    //   2. `success === true` → definitely succeeded
    //   3. `status` present + numeric + not in {1, 200} → failed
    //   4. Otherwise → trust HTTP 200, let the per-endpoint parser decide
    //
    // This keeps login working (no flags → trust HTTP) AND search working
    // (success: true wins over confusing status numbers).
    const body =
      parsedBody !== null && typeof parsedBody === 'object'
        ? (parsedBody as Record<string, unknown>)
        : null;
    const envelopeSuccess =
      body && 'success' in body && typeof body.success === 'boolean'
        ? (body.success as boolean)
        : null;
    const hasEnvelopeStatus = body !== null && 'status' in body;
    const envelopeStatus = hasEnvelopeStatus ? Number(body!.status) : undefined;
    const envelopeMsg =
      body && 'message' in body ? String(body.message ?? '') : undefined;

    const SUCCESS_STATUS = new Set([1, 200]);
    const isFailure =
      envelopeSuccess === false ||
      (envelopeSuccess === null &&
        hasEnvelopeStatus &&
        Number.isFinite(envelopeStatus) &&
        !SUCCESS_STATUS.has(envelopeStatus as number));

    if (isFailure) {
      const mapped = mapKafilaVendorError(
        args.operation,
        envelopeStatus ?? 0,
        envelopeMsg,
        httpStatus,
      );
      await this.persistLog({
        ...args,
        correlationId,
        httpStatus,
        response: parsedBody,
        responseHeaders,
        durationMs,
        kafilaStatus: envelopeStatus,
        errorCode: mapped.code,
        errorMessage: mapped.message,
      });
      throw mapped;
    }

    await this.persistLog({
      ...args,
      correlationId,
      httpStatus,
      response: parsedBody,
      responseHeaders: headers,
      durationMs,
      kafilaStatus: envelopeStatus,
    });

    return parse(parsedBody);
  }

  // ────────── Phase 2: search + pricing ──────────

  /** POST /api/Search/v2/LowFareSearch — the search call. Caller passes
   *  a fully-built request body (mapped from NormalizedSearchRequest by
   *  the adapter); we just send it and parse the response. */
  async lowFareSearch(
    body: KflSearchRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflSearchResponseT> {
    return this.call(
      {
        operation: 'LowFareSearch',
        method: 'POST',
        // Vendor's path uses capital "Search" — DO NOT lowercase it.
        path: '/api/Search/v2/LowFareSearch',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      (raw) => KflSearchResponse.parse(raw),
    );
  }

  /** POST /api/prebook/v2/AirPricing — fare re-validation (FCheck).
   *  MUST be called before HoldPnr / CreatePnr. The response itinerary
   *  MUST be re-sent unchanged to CreatePnr — the adapter persists it
   *  to KafilaSearchSession.pricingByUId. */
  async airPricing(
    body: KflPricingRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflPricingResponseT> {
    return this.call(
      {
        operation: 'AirPricing',
        method: 'POST',
        path: '/api/prebook/v2/AirPricing',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      (raw) => KflPricingResponse.parse(raw),
    );
  }

  // ────────── Phase 3: SSR catalog + seat map ──────────
  //
  // Both endpoints take the same request body shape as AirPricing — caller
  // builds it via toKafilaPricingRequest(). For round-trip seat picks the
  // spec mandates one call per journeyKey, so the caller iterates.

  /** POST /api/prebook/v2/GetSSRs — meal / baggage / fast-forward catalog.
   *  Per-segment meals live under `airSegments[].ssrInfo.meal`; baggage +
   *  fast-forward live under per-OD `ancillaries[]`. Each option's `key`
   *  is opaque and must be replayed unchanged in CreatePnr. */
  async getSSRs(
    body: KflPricingRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflSSRResponseT> {
    return this.call(
      {
        operation: 'GetSSRs',
        method: 'POST',
        path: '/api/prebook/v2/GetSSRs',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      (raw) => KflSSRResponse.parse(raw),
    );
  }

  /** POST /api/prebook/v2/GetSeatMap — seat layout per segment. Returns
   *  `airSegments[].seatRows[].facilities[]` where each facility is a
   *  seat object with opaque `key`. For round-trip, call once per
   *  journeyKey. */
  async getSeatMap(
    body: KflPricingRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflSeatMapResponseT> {
    return this.call(
      {
        operation: 'GetSeatMap',
        method: 'POST',
        path: '/api/prebook/v2/GetSeatMap',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      (raw) => KflSeatMapResponse.parse(raw),
    );
  }

  // ────────── Phase 4: booking lifecycle ──────────
  //
  // NEVER retried automatically. The whole point of `rmFields[]
  // BOOKING_REFERENCE_NUMBER` carrying a stable correlationId is so a
  // retry on the caller's side de-duplicates server-side — but we don't
  // know if the duplicate has been observed yet, so the safest move is
  // to never retry these endpoints from the client. Callers handle
  // status follow-up via retriveBooking().

  /** POST /api/book/v2/CreatePnr — atomic book + (optionally) ticket.
   *  When `journey[].issueTicket: true`, the response includes ticket
   *  numbers under `Passengers[].Optional.ticketDetails[]`. */
  async createPnr(
    body: KflCreatePnrRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflBookingResponseT> {
    return this.call(
      {
        operation: 'CreatePnr',
        method: 'POST',
        path: '/api/book/v2/CreatePnr',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      (raw) => KflBookingResponse.parse(raw),
    );
  }

  /** POST /api/book/v2/HoldPnr — same request shape, but with
   *  `issueTicket: false` per journey. Reserved for the rare "ticket
   *  later" B2B workflow — not supported for LCC fares (caller checks
   *  itinerary.isLCC before invoking). */
  async holdPnr(
    body: KflCreatePnrRequestT,
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflBookingResponseT> {
    return this.call(
      {
        operation: 'HoldPnr',
        method: 'POST',
        path: '/api/book/v2/HoldPnr',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId,
      },
      // HoldPnr's response is the KflHoldPnrResponse shape (recLoc per
      // journey, no BookingInfo), but we parse it as KflBookingResponse
      // with .passthrough() so both flows share post-processing. Phase
      // 4.5 may switch to the dedicated schema once the workflow lands.
      (raw) => KflBookingResponse.parse(raw),
    );
  }

  /** POST /api/flightbooking/retriveBooking — look up an existing
   *  booking by `bookingId`, `traceId`, or `pnr`. Used to:
   *    - Fetch current status / ticket numbers after the async CreatePnr
   *      path returned PENDING.
   *    - Re-fetch a booking made elsewhere (B2B "import" flow).
   *
   *  Per the Postman collection, this endpoint takes NO Authorization
   *  header. We honour that via `unauthenticated: true` — first time
   *  this hits UAT it may turn out to need auth after all; flip the
   *  flag and re-run if so. */
  async retriveBooking(
    body: { bookingId?: string; traceId?: string; pnr?: string },
    opts: { correlationId: string; bookingId?: string } = { correlationId: randomUUID() },
  ): Promise<KflBookingResponseT> {
    return this.call(
      {
        operation: 'retriveBooking',
        method: 'POST',
        path: '/api/flightbooking/retriveBooking',
        body,
        correlationId: opts.correlationId,
        bookingId: opts.bookingId ?? body.bookingId,
        unauthenticated: true,
      },
      (raw) => KflBookingResponse.parse(raw),
    );
  }

  // ────────── Internals ──────────

  private buildUrl(path: string): string {
    const base = this.cfg.baseUrl.replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  /** Force-refresh path. Coalesces concurrent callers via `loginInflight`
   *  so a cold cache miss doesn't fan out into N parallel logins. */
  private refreshToken(): Promise<string> {
    if (this.loginInflight) return this.loginInflight;
    this.loginInflight = (async () => {
      try {
        const body: KflLoginRequestT = {
          userId: this.cfg.userId,
          apiKey: this.cfg.apiKey,
          apiSecret: this.cfg.apiSecret,
        };
        const parsed = await this.call(
          {
            operation: 'login',
            method: 'POST',
            path: '/api/auth/login',
            body,
            unauthenticated: true,
          },
          (raw) => KflLoginResponse.parse(raw),
        );
        if (!parsed.token) {
          // status===1 but no token → vendor protocol violation.
          throw new KafilaError(
            'AUTH',
            `Kafila login returned status=1 but no token (message=${parsed.message ?? 'n/a'})`,
          );
        }
        await redis.set(this.cfg.jwtCacheKey, parsed.token, 'EX', this.cfg.jwtTtlSeconds);
        logger.info(
          { supplier: 'KAFILA', ttlSec: this.cfg.jwtTtlSeconds },
          'kafila token refreshed',
        );
        return parsed.token;
      } finally {
        this.loginInflight = null;
      }
    })();
    return this.loginInflight;
  }

  /** Persist one audit-log row. Best-effort: write failures are logged
   *  but don't break the caller — losing one audit row is better than
   *  failing a live booking call. */
  private async persistLog(args: {
    operation: string;
    correlationId: string;
    bookingId?: string;
    body?: unknown;
    path: string;
    httpStatus?: number;
    response: unknown;
    responseHeaders: Record<string, string> | null;
    durationMs: number;
    kafilaStatus?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await KafilaApiLog.create({
        operation: args.operation,
        url: this.buildUrl(args.path),
        bookingId: args.bookingId ?? null,
        correlationId: args.correlationId,
        request: redactSecrets(args.body),
        response: args.response,
        responseHeaders: args.responseHeaders,
        durationMs: args.durationMs,
        httpStatus: args.httpStatus ?? null,
        kafilaStatus: args.kafilaStatus ?? null,
        errorCode: args.errorCode ?? null,
        errorMessage: args.errorMessage ?? null,
      });
    } catch (err) {
      // Don't let an audit-log failure cascade — the call result is what
      // matters. Log at warn so ops can catch a Mongo outage but the
      // booking path stays green.
      logger.warn(
        { supplier: 'KAFILA', operation: args.operation, err },
        'kafila audit-log persist failed',
      );
    }
  }
}

/** Shallow + recursive redaction: drops any key in REDACTED_REQUEST_FIELDS
 *  from objects/arrays before they hit Mongo. We DON'T deep-clone large
 *  objects — Mongoose handles serialization. Returns a new object so we
 *  don't mutate the caller's input. */
function redactSecrets(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(redactSecrets);
  if (typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_REQUEST_FIELDS.has(k)) {
      out[k] = '***REDACTED***';
    } else {
      out[k] = redactSecrets(v);
    }
  }
  return out;
}

/** Read Kafila config from env. Returns null if KAFILA_ENABLED=false or
 *  required creds are missing — matches the AirIQ / TBO null-on-misconfig
 *  pattern so the adapter is silently skipped. */
export function readKafilaConfigFromEnv(): KafilaClientConfig | null {
  if (!env.KAFILA_ENABLED) return null;
  if (!env.KAFILA_USER_ID || !env.KAFILA_API_KEY || !env.KAFILA_API_SECRET) {
    return null;
  }
  return {
    baseUrl: env.KAFILA_BASE_URL,
    userId: env.KAFILA_USER_ID,
    apiKey: env.KAFILA_API_KEY,
    apiSecret: env.KAFILA_API_SECRET,
    companyId: env.KAFILA_COMPANY_ID,
    credentialType: env.KAFILA_CREDENTIAL_TYPE,
    salesChannel: env.KAFILA_SALES_CHANNEL,
    timeoutMs: env.KAFILA_HTTP_TIMEOUT_MS,
    jwtCacheKey: env.KAFILA_JWT_CACHE_KEY,
    jwtTtlSeconds: env.KAFILA_JWT_TTL_SECONDS,
  };
}
