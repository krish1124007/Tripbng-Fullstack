// AirIQClient — HTTP layer for AirIQ AAS v1.0.
//
// Builds the custom Basic Auth header (Base64(AgentID*Username:Password) — see
// utils.ts), POSTs JSON to TravelAPI.svc, and parses the {Status, ...} envelope.
// Application errors (Status.ResultCode !== 1) throw SupplierAdapterError so
// the existing pipeline handles them like any other supplier failure.
//
// Token injection + auto-refresh on "token timed out" is layered in by
// AirIQAdapter via TokenManager — this client just does HTTP + envelope parsing.

import { logger } from '../../config/logger.js';
import { throwAsSupplierError } from './errors.js';
import { buildAirIQAuthHeader } from './utils.js';
import type {
  AirIQAvailabilityRequest,
  AirIQAvailabilityResponse,
  AirIQLoginResponse,
  AirIQStatus,
} from './types.js';

export interface AirIQClientConfig {
  baseUrl: string;
  agentId: string;
  username: string;
  password: string;
  appType: string; // 'API'
  apiVersion: string; // 'V1.0'
  /** Per-request fetch timeout in ms. Defaults to 30s — Pricing/Book are slow. */
  timeoutMs?: number;
}

const SUPPLIER_CODE_FOR_ERRORS = { code: 'AIRIQ' } as const;

interface AirIQEnvelope {
  Status: AirIQStatus;
}

export class AirIQClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  readonly appType: string;
  readonly apiVersion: string;
  private readonly timeoutMs: number;

  constructor(config: AirIQClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.authHeader = buildAirIQAuthHeader(config.agentId, config.username, config.password);
    this.appType = config.appType;
    this.apiVersion = config.apiVersion;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  // ────────── Public methods ──────────

  /** Login does not take a token. Returns the new token + envelope. */
  async login(): Promise<AirIQLoginResponse> {
    return this.post<AirIQLoginResponse>('Login', {
      AppType: this.appType,
      ApiVersion: this.apiVersion,
    });
  }

  /** Availability — search call. Token must be present in the request body. */
  async availability(req: AirIQAvailabilityRequest): Promise<AirIQAvailabilityResponse> {
    return this.post<AirIQAvailabilityResponse>('Availability', req);
  }

  // ────────── Internals ──────────

  private async post<Res extends AirIQEnvelope>(operation: string, body: unknown): Promise<Res> {
    const url = `${this.baseUrl}/${operation}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.authHeader,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      logger.warn(
        { supplier: 'AIRIQ', operation, ms: Date.now() - startedAt, err },
        'airiq transport failure',
      );
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { supplier: 'AIRIQ', operation, status: res.status, ms: Date.now() - startedAt },
        'airiq non-2xx',
      );
      throwAsSupplierError(
        '0',
        `HTTP ${res.status} ${text || res.statusText}`.trim(),
        undefined,
        SUPPLIER_CODE_FOR_ERRORS,
      );
    }

    let parsed: Res;
    try {
      parsed = (await res.json()) as Res;
    } catch (err) {
      logger.warn(
        { supplier: 'AIRIQ', operation, ms: Date.now() - startedAt, err },
        'airiq json parse failed',
      );
      throwAsSupplierError(
        '-1',
        'Could not parse AirIQ response',
        undefined,
        SUPPLIER_CODE_FOR_ERRORS,
      );
    }

    const status = parsed.Status;
    // ResultCode === "1" is success; "2" is "pending" (Book / IssueTicket only — does
    // not occur on Login/Availability so we treat it as an unexpected state).
    // Confirmed via live test endpoint: ResultCode is a JSON string ("0", "1", ...).
    const codeStr = String(status?.ResultCode ?? '');
    if (!status || codeStr !== '1') {
      logger.warn(
        {
          supplier: 'AIRIQ',
          operation,
          ms: Date.now() - startedAt,
          resultCode: codeStr,
          error: status?.Error,
          sequenceId: status?.SequenceID,
        },
        'airiq application error',
      );
      throwAsSupplierError(
        codeStr,
        status?.Error ?? 'Unknown AirIQ error',
        status?.SequenceID,
        SUPPLIER_CODE_FOR_ERRORS,
      );
    }

    logger.debug(
      {
        supplier: 'AIRIQ',
        operation,
        ms: Date.now() - startedAt,
        sequenceId: status.SequenceID,
      },
      'airiq call ok',
    );
    return parsed;
  }
}

/** Read AirIQ config from env — returns null if not configured. */
export function readAirIQConfigFromEnv(): AirIQClientConfig | null {
  const baseUrl = process.env.AIRIQ_BASE_URL;
  const agentId = process.env.AIRIQ_AGENT_ID;
  const username = process.env.AIRIQ_USERNAME;
  const password = process.env.AIRIQ_PASSWORD;
  if (!baseUrl || !agentId || !username || !password) return null;
  const appType = process.env.AIRIQ_APP_TYPE ?? 'API';
  const apiVersion = process.env.AIRIQ_API_VERSION ?? 'V1.0';
  const timeoutMs = process.env.AIRIQ_HTTP_TIMEOUT_MS
    ? parseInt(process.env.AIRIQ_HTTP_TIMEOUT_MS, 10)
    : undefined;
  return { baseUrl, agentId, username, password, appType, apiVersion, timeoutMs };
}
