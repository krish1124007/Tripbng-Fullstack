// AsegoClient — POST/GET helper for ASEGO B2B Travel Insurance API.
//
// Same shape as our other supplier clients (EtravFlightClient, AirIQClient):
// fetch + AbortController for timeout, plain JSON in/out, application errors
// (envelope with `success: false` or non-2xx status) thrown as AsegoError.
//
// The only ASEGO endpoint that needs encryption today is `createPolicy`. That
// path encrypts the body via crypto.ts before posting; the rest send plain
// JSON. Network/transport errors propagate as native fetch errors (caller
// catches and maps).

import { logger } from '../../config/logger.js';
import { AsegoError } from './errors.js';

export interface AsegoClientConfig {
  baseUrl: string;
  apiPrefix: string;
  userAgent: string;
  timeoutMs?: number;
  /** Number of retries on network / 5xx errors. createPolicy is not retried. */
  retryCount?: number;
}

export function readAsegoClientConfigFromEnv(): AsegoClientConfig | null {
  const baseUrl = process.env.ASEGO_BASE_URL;
  const apiPrefix = process.env.ASEGO_API_PREFIX;
  if (!baseUrl || !apiPrefix) return null;
  return {
    baseUrl,
    apiPrefix,
    userAgent: process.env.ASEGO_USER_AGENT ?? 'TripBNG-API/1.0',
    timeoutMs: process.env.ASEGO_REQUEST_TIMEOUT_MS
      ? parseInt(process.env.ASEGO_REQUEST_TIMEOUT_MS, 10)
      : undefined,
    retryCount: process.env.ASEGO_RETRY_COUNT
      ? parseInt(process.env.ASEGO_RETRY_COUNT, 10)
      : undefined,
  };
}

export interface AsegoRequestOptions {
  /** Disable retries for this call (used by createPolicy — non-idempotent). */
  noRetry?: boolean;
  /** Pre-encrypted ciphertext to send as the request body verbatim. */
  rawBody?: string;
  /** Override Content-Type when posting raw ciphertext. */
  contentType?: string;
}

export class AsegoClient {
  private readonly base: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;

  constructor(cfg: AsegoClientConfig) {
    // Strip trailing slashes so we can append paths predictably.
    const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    const apiPrefix = `/${cfg.apiPrefix.replace(/^\/+/, '').replace(/\/+$/, '')}`;
    this.base = `${baseUrl}${apiPrefix}`;
    this.userAgent = cfg.userAgent;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.retryCount = cfg.retryCount ?? 2;
  }

  /** GET — used for /currency, /category, /plan/masterDetails, /plan, /reasons, /download. */
  async get<Res = unknown>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<Res> {
    const url = this.buildUrl(path, query);
    return this.requestWithRetry<Res>(url, { method: 'GET' }, false);
  }

  /** POST plain JSON — most transactional calls. */
  async post<Req extends object, Res = unknown>(
    path: string,
    body: Req,
    opts: AsegoRequestOptions = {},
  ): Promise<Res> {
    const url = this.buildUrl(path);
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': opts.contentType ?? 'application/json',
        Accept: 'application/json',
      },
      body: opts.rawBody ?? JSON.stringify(body),
    };
    return this.requestWithRetry<Res>(url, init, opts.noRetry === true);
  }

  /** GET that returns the raw fetch Response (used by /download for binary streaming). */
  async getRaw(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<Response> {
    const url = this.buildUrl(path, query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  // ────────── Internals ──────────

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.base}${cleanPath}`;
    if (!query) return url;
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `${url}?${qs}` : url;
  }

  /**
   * Single attempt: native fetch + AbortController timeout. Throws AsegoError
   * for application/HTTP failures and lets transport errors (which `fetch`
   * raises as plain Errors) propagate so the retry logic above can decide
   * whether to retry.
   */
  private async requestOnce<Res>(url: string, init: RequestInit, attempt: number): Promise<Res> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers ?? {}),
          'User-Agent': this.userAgent,
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const ms = Date.now() - startedAt;

    // Try to parse JSON body either way — error responses also carry useful
    // payload (`{ code, msg }`) and we want to surface them in AsegoError.
    let body: unknown;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const codeMsg = extractCodeMsg(body, res.status);
      logger.warn(
        {
          supplier: 'ASEGO',
          url,
          status: res.status,
          ms,
          attempt,
          errorCode: codeMsg.code,
          errorMsg: codeMsg.msg,
        },
        'asego non-2xx',
      );
      throw new AsegoError(codeMsg.code, codeMsg.msg, res.status, url, body);
    }

    // 200 with `success: false` envelope — surface as application error.
    if (
      body &&
      typeof body === 'object' &&
      'success' in body &&
      (body as { success: unknown }).success === false
    ) {
      const codeMsg = extractCodeMsg(body, 200);
      logger.warn(
        { supplier: 'ASEGO', url, ms, attempt, errorCode: codeMsg.code, errorMsg: codeMsg.msg },
        'asego application error',
      );
      throw new AsegoError(codeMsg.code, codeMsg.msg, 200, url, body);
    }

    logger.debug({ supplier: 'ASEGO', url, status: res.status, ms, attempt }, 'asego call ok');
    return body as Res;
  }

  /**
   * Exponential-backoff retry on network errors and 5xx HTTP errors only.
   * 4xx responses (client errors, dedup, validation) bubble up immediately —
   * retrying won't help and could double-charge the customer for createPolicy.
   */
  private async requestWithRetry<Res>(
    url: string,
    init: RequestInit,
    noRetry: boolean,
  ): Promise<Res> {
    const maxAttempts = noRetry ? 1 : this.retryCount + 1;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.requestOnce<Res>(url, init, attempt);
      } catch (err) {
        lastErr = err;
        if (noRetry || attempt === maxAttempts || !isRetryable(err)) {
          throw err;
        }
        const backoffMs = Math.min(2_000 * Math.pow(2, attempt - 1), 8_000);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
    throw lastErr;
  }
}

function isRetryable(err: unknown): boolean {
  // Transport errors (DNS, connection reset, abort) — the fetch promise rejects
  // with a plain Error — always retry.
  if (!(err instanceof AsegoError)) return true;
  // 5xx from ASEGO — likely transient.
  return err.httpStatus >= 500 && err.httpStatus <= 599;
}

function extractCodeMsg(body: unknown, fallbackStatus: number): { code: string; msg: string } {
  if (body && typeof body === 'object') {
    const b = body as { code?: unknown; msg?: unknown; message?: unknown };
    const code =
      typeof b.code === 'string' || typeof b.code === 'number'
        ? String(b.code)
        : `HTTP_${fallbackStatus}`;
    const msg =
      typeof b.msg === 'string'
        ? b.msg
        : typeof b.message === 'string'
          ? b.message
          : 'ASEGO call failed';
    return { code, msg };
  }
  return {
    code: `HTTP_${fallbackStatus}`,
    msg: typeof body === 'string' ? body || 'ASEGO call failed' : 'ASEGO call failed',
  };
}
