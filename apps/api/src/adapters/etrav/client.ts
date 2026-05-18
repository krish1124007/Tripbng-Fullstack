// EtravFlightClient — POST helper for eTrav Air API.
//
// Injects the per-request Auth_Header (UUID v4 Request_Id, tenant credentials),
// posts JSON, and parses the eTrav response envelope. Application errors
// (Error_Code !== "0000") are thrown as SupplierAdapterError so the existing
// pipeline handles them like any other supplier failure.
//
// Network/transport errors and timeouts are caught by BaseAdapter's `guarded()`
// helper — this client just does HTTP + envelope parsing.

import { randomUUID } from 'node:crypto';
import { logger } from '../../config/logger.js';
import { throwAsSupplierError } from './errors.js';
import type {
  EtravAirFareRuleRequest,
  EtravAirFareRuleResponse,
  EtravAirRepriceRequest,
  EtravAirRepriceResponse,
  EtravAirSearchRequest,
  EtravAirSearchResponse,
  EtravAirTempBookingRequest,
  EtravAirTempBookingResponse,
  EtravAirTicketingRequest,
  EtravAirTicketingResponse,
  EtravAuthHeader,
  EtravResponseHeader,
} from './types.js';

export interface EtravClientConfig {
  baseUrl: string;
  userId: string;
  password: string;
  ipAddress: string;
  imeiNumber: string;
  /** Per-request fetch timeout in ms. Defaults to 15 s — international searches can be slow. */
  timeoutMs?: number;
}

/** Loaded from env once at boot. Falsy values mean eTrav is not configured. */
export function readEtravConfigFromEnv(): EtravClientConfig | null {
  const baseUrl = process.env.ETRAV_BASE_URL;
  const userId = process.env.ETRAV_USER_ID;
  const password = process.env.ETRAV_PASSWORD;
  const ipAddress = process.env.ETRAV_IP_ADDRESS;
  const imeiNumber = process.env.ETRAV_IMEI_NUMBER ?? 'tripbng-server';
  if (!baseUrl || !userId || !password || !ipAddress) {
    return null;
  }
  const timeoutMs = process.env.ETRAV_TIMEOUT_MS
    ? parseInt(process.env.ETRAV_TIMEOUT_MS, 10)
    : undefined;
  return { baseUrl, userId, password, ipAddress, imeiNumber, timeoutMs };
}

const SUPPLIER_CODE_FOR_ERRORS = { code: 'ETRAV' } as const;

export class EtravFlightClient {
  private readonly baseUrl: string;
  private readonly creds: Omit<EtravAuthHeader, 'Request_Id'>;
  private readonly timeoutMs: number;

  constructor(config: EtravClientConfig) {
    // Strip trailing slash so we can append the path predictably.
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.creds = {
      UserId: config.userId,
      Password: config.password,
      IP_Address: config.ipAddress,
      IMEI_Number: config.imeiNumber,
    };
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  /** Fresh Auth_Header per request — Request_Id is a new UUID v4 every time. */
  buildAuthHeader(): EtravAuthHeader {
    return { ...this.creds, Request_Id: randomUUID() };
  }

  // ────────── Public methods ──────────

  async search(req: Omit<EtravAirSearchRequest, 'Auth_Header'>): Promise<EtravAirSearchResponse> {
    return this.post<EtravAirSearchRequest, EtravAirSearchResponse>(
      'airlinehost/AirAPIService.svc/JSONService/Air_Search',
      { Auth_Header: this.buildAuthHeader(), ...req },
    );
  }

  async fareRule(
    req: Omit<EtravAirFareRuleRequest, 'Auth_Header'>,
  ): Promise<EtravAirFareRuleResponse> {
    return this.post<EtravAirFareRuleRequest, EtravAirFareRuleResponse>(
      'airlinehost/AirAPIService.svc/JSONService/Air_FareRule',
      { Auth_Header: this.buildAuthHeader(), ...req },
    );
  }

  async reprice(
    req: Omit<EtravAirRepriceRequest, 'Auth_Header'>,
  ): Promise<EtravAirRepriceResponse> {
    return this.post<EtravAirRepriceRequest, EtravAirRepriceResponse>(
      'airlinehost/AirAPIService.svc/JSONService/Air_Reprice',
      { Auth_Header: this.buildAuthHeader(), ...req },
    );
  }

  async tempBooking(
    req: Omit<EtravAirTempBookingRequest, 'Auth_Header'>,
  ): Promise<EtravAirTempBookingResponse> {
    return this.post<EtravAirTempBookingRequest, EtravAirTempBookingResponse>(
      'airlinehost/AirAPIService.svc/JSONService/Air_TempBooking',
      { Auth_Header: this.buildAuthHeader(), ...req },
    );
  }

  /** Air_Ticketing — three modes via `Ticketing_Type`:
   *    0 = Hold attempt (no payment)
   *    1 = Issue ticket (REQUIRES AddPayment first — wallet debit)
   *    2 = Issue ticket alt (also payment-gated)
   *
   *  Discovered live (May-2026). Issue modes are gated behind explicit
   *  payment authorisation; the booking service is responsible for not
   *  calling `ticketing(Issue)` until AddPayment specs land + wallet
   *  is funded. */
  async ticketing(
    req: Omit<EtravAirTicketingRequest, 'Auth_Header'>,
  ): Promise<EtravAirTicketingResponse> {
    return this.post<EtravAirTicketingRequest, EtravAirTicketingResponse>(
      'airlinehost/AirAPIService.svc/JSONService/Air_Ticketing',
      { Auth_Header: this.buildAuthHeader(), ...req },
    );
  }

  // ────────── Internals ──────────

  private async post<Req, Res extends { Response_Header: EtravResponseHeader }>(
    path: string,
    body: Req,
  ): Promise<Res> {
    const url = `${this.baseUrl}/${path}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      logger.warn(
        { supplier: 'ETRAV', path, ms: Date.now() - startedAt, err },
        'etrav transport failure',
      );
      throw err;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn(
        { supplier: 'ETRAV', path, status: res.status, ms: Date.now() - startedAt },
        'etrav non-2xx',
      );
      // HTTP-level failure — typically means transport/host issue, not application.
      throwAsSupplierError(`HTTP_${res.status}`, text || res.statusText, SUPPLIER_CODE_FOR_ERRORS);
    }

    let parsed: Res;
    try {
      parsed = (await res.json()) as Res;
    } catch (err) {
      logger.warn(
        { supplier: 'ETRAV', path, ms: Date.now() - startedAt, err },
        'etrav json parse failed',
      );
      throwAsSupplierError(
        'PARSE_ERROR',
        'Could not parse eTrav response',
        SUPPLIER_CODE_FOR_ERRORS,
      );
    }

    const header = parsed.Response_Header;
    if (!header || header.Error_Code !== '0000') {
      // Application-level error — surface the eTrav code.
      logger.warn(
        {
          supplier: 'ETRAV',
          path,
          ms: Date.now() - startedAt,
          errorCode: header?.Error_Code,
          errorDesc: header?.Error_Desc,
          requestId: header?.Request_Id,
        },
        'etrav application error',
      );
      throwAsSupplierError(
        header?.Error_Code ?? 'UNKNOWN',
        header?.Error_Desc ?? 'Unknown eTrav error',
        SUPPLIER_CODE_FOR_ERRORS,
      );
    }

    logger.debug(
      {
        supplier: 'ETRAV',
        path,
        ms: Date.now() - startedAt,
        requestId: header.Request_Id,
      },
      'etrav call ok',
    );
    return parsed;
  }
}
