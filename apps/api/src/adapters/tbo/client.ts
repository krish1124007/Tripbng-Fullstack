// TBO HTTP client — fetch-based, audit-instrumented, host-aware.
//
// Why fetch (not axios as the spec proposes): the rest of this codebase is
// fetch-based (eTrav adapter, ASEGO adapter, WhatsApp + analytics services)
// and adding axios just for TBO splits the dependency surface. The behaviour
// the spec gets from axios interceptors (audit, token injection, retry on
// InValidSession) we replicate here in 80 lines.
//
// Every call:
//   1. Resolves the target host via TBO_HOSTS[host]().
//   2. POSTs JSON with a 30s AbortController timeout (configurable).
//   3. Persists a TboAuditLog row with redacted bodies + headers + duration.
//   4. Bubbles transport errors as TboError(code='TBO_TRANSPORT', retryable=true).
//
// Token injection + retry-on-InValidSession is layered on top of this client
// in services/tbo/auth.service.ts via a `withToken()` wrapper — this primitive
// stays unaware of auth state so it can be reused by Authenticate itself.

import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { runWithoutTenant } from '../../middleware/tenant-context.js';
import { TboAuditLog } from '../../models/TboAuditLog.js';
import { TboError, statusToErrorCode } from './errors.js';
import { TBO_HOSTS, type TboHost } from './hosts.js';
import { redactForAudit } from './redact.js';

export interface TboCallContext {
  /** Internal Booking._id when this call is part of a booking flow. */
  bookingId?: string | null;
  /** TBO BookingCode — set on PreBook and forwards through Book/Voucher. */
  bookingCode?: string | null;
  /** Free-form correlation id for log grouping. */
  correlationKey?: string;
}

export interface TboCallOptions {
  /** Path on the host (must start with `/`). E.g. `/Authenticate`. */
  path: string;
  /** Which of the three TBO hosts to target. */
  host: TboHost;
  /** Method name for the audit log. Distinct from path because some paths
   *  are shared across multiple logical calls in TBO docs. */
  method: string;
  body: Record<string, unknown>;
  /** Override the default request timeout. */
  timeoutMs?: number;
  ctx?: TboCallContext;
}

/**
 * The two TBO services use different response envelopes:
 *   SharedData  → `Status: number` (1..5) + `Error: { ErrorCode, ErrorMessage }`
 *   HotelAPI    → `Status: { Code: number, Description: string }`
 * Both are accepted here; persistAudit normalises to a flat numeric tboStatus.
 */
interface TboResponseBody {
  Status?: number | { Code?: number; Description?: string };
  Error?: { ErrorCode?: number; ErrorMessage?: string };
  TraceId?: string;
}

/**
 * Issue a TBO API call. Returns the parsed JSON body on transport success
 * (HTTP 2xx), regardless of TBO's business-layer Status. Callers inspect
 * `Status` themselves and translate into domain errors via statusToErrorCode.
 *
 * Throws TboError only for transport failures (timeout, 5xx, JSON parse) —
 * NOT for Status=2/3/4/5. That asymmetry is deliberate: TBO's "InValidSession"
 * is recoverable via token refresh, and the auth service needs the raw
 * response to make that decision.
 */
export async function callTbo<TResponse extends TboResponseBody = TboResponseBody>(
  opts: TboCallOptions,
): Promise<TResponse> {
  if (!env.TBO_ENABLED) {
    throw new TboError('TBO_DISABLED', 'TBO integration is not enabled', {
      method: opts.method,
      retryable: false,
    });
  }

  const url = `${TBO_HOSTS[opts.host]()}${opts.path}`;
  const timeoutMs = opts.timeoutMs ?? env.TBO_REQUEST_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const startedAt = Date.now();
  let httpStatus: number | null = null;
  let parsed: TResponse | null = null;
  let responseHeaders: Record<string, string> | null = null;
  let transportError: Error | null = null;

  // SharedData uses TokenId-in-body; the TBO Holidays Hotel API and Hotel-BE
  // services use HTTP Basic Auth. Inject the Authorization header for the
  // latter two, falling back to TBO_USERNAME/TBO_PASSWORD when no
  // hotel-specific credentials are set (some accounts share the pair).
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (opts.host === 'hotel' || opts.host === 'hotelBe') {
    const user = env.TBO_HOTEL_USERNAME ?? env.TBO_USERNAME;
    const pass = env.TBO_HOTEL_PASSWORD ?? env.TBO_PASSWORD;
    if (user && pass) {
      headers.Authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    httpStatus = res.status;
    responseHeaders = headersToObject(res.headers);

    const text = await res.text();
    if (!res.ok) {
      transportError = new TboError(
        'TBO_TRANSPORT',
        `${opts.method} returned ${res.status}: ${text.slice(0, 200)}`,
        { method: opts.method, httpStatus: res.status, retryable: res.status >= 500 },
      );
    } else {
      try {
        parsed = JSON.parse(text) as TResponse;
      } catch {
        transportError = new TboError(
          'TBO_UNKNOWN',
          `${opts.method} returned non-JSON body`,
          { method: opts.method, httpStatus: res.status, retryable: false },
        );
      }
    }
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    transportError = new TboError(
      'TBO_TRANSPORT',
      isAbort
        ? `${opts.method} timed out after ${timeoutMs}ms`
        : `${opts.method} transport error: ${(err as Error).message}`,
      { method: opts.method, retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  // Persist audit row — fire-and-forget so a slow Mongo write doesn't block
  // the API path. Wrapped in runWithoutTenant() because the cron worker
  // doesn't carry an ALS tenant context.
  void persistAudit({
    method: opts.method,
    host: opts.host,
    url,
    request: opts.body,
    response: parsed,
    responseHeaders,
    httpStatus,
    durationMs,
    parsed,
    transportError,
    ctx: opts.ctx,
  }).catch((err) => {
    logger.warn({ err, method: opts.method }, 'tbo: audit persist failed');
  });

  if (transportError) throw transportError;
  if (!parsed) {
    throw new TboError('TBO_UNKNOWN', `${opts.method} returned empty body`, {
      method: opts.method,
      httpStatus: httpStatus ?? undefined,
      retryable: false,
    });
  }
  return parsed;
}

interface PersistAuditArgs {
  method: string;
  host: TboHost;
  url: string;
  request: Record<string, unknown>;
  response: TboResponseBody | null;
  responseHeaders: Record<string, string> | null;
  httpStatus: number | null;
  durationMs: number;
  parsed: TboResponseBody | null;
  transportError: Error | null;
  ctx?: TboCallContext;
}

async function persistAudit(args: PersistAuditArgs): Promise<void> {
  // Normalise to a numeric tboStatus + upstream message regardless of which
  // TBO service shape we got back. SharedData = numeric Status; HotelAPI =
  // { Code, Description } object.
  const rawStatus = args.parsed?.Status;
  let tboStatus: number | null = null;
  let upstreamMessage: string | null = null;
  if (typeof rawStatus === 'number') {
    tboStatus = rawStatus;
    upstreamMessage = args.parsed?.Error?.ErrorMessage ?? null;
  } else if (rawStatus && typeof rawStatus === 'object') {
    const obj = rawStatus as { Code?: number; Description?: string };
    if (typeof obj.Code === 'number') tboStatus = obj.Code;
    upstreamMessage = obj.Description ?? null;
  }
  // statusToErrorCode is SharedData-specific (1..5). HotelAPI codes (200,401,…)
  // don't map to those — fall through to the upstream message instead.
  const errCodeFromStatus =
    tboStatus != null && tboStatus >= 1 && tboStatus <= 5
      ? statusToErrorCode(tboStatus as 1 | 2 | 3 | 4 | 5)
      : null;
  const errMessage =
    args.transportError?.message ??
    upstreamMessage ??
    (errCodeFromStatus ? errCodeFromStatus : null);

  await runWithoutTenant(async () => {
    await TboAuditLog.create({
      method: args.method,
      host: args.host,
      url: args.url,
      bookingId: args.ctx?.bookingId ?? null,
      bookingCode: args.ctx?.bookingCode ?? null,
      traceId: args.parsed?.TraceId ?? null,
      sessionId: args.responseHeaders?.['sessionid'] ?? args.responseHeaders?.['SessionId'] ?? null,
      request: redactForAudit(args.request),
      response: args.parsed ? redactForAudit(args.parsed) : null,
      responseHeaders: args.responseHeaders,
      durationMs: args.durationMs,
      httpStatus: args.httpStatus,
      tboStatus,
      errorCode: args.parsed?.Error?.ErrorCode ?? null,
      errorMessage: errMessage,
    });
  });
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}
