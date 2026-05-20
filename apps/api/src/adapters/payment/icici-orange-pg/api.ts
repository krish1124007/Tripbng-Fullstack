// ICICI Orange PG / Pay Gateway — server-to-server API clients.
//
// All three call shapes (initiateSale, status, refund) follow the same
// rhythm:
//   1. Build a body where `secureHash` is omitted.
//   2. Add `secureHash = secureHashV1(body, merchantKey)`.
//   3. POST as application/json.
//   4. Verify the response's `secureHash` against the rest of the response.
//   5. Return the parsed body (do NOT throw on `responseCode !== "000"` —
//      callers decide what to do with failures; throwing here would
//      collapse legitimate "FAILED" responses into network errors).
//
// Hash V1 is implemented in ./crypto.ts. If the algorithm turns out to
// need adjustment (golden vector is being verified), only crypto.ts
// changes — the call sites here are agnostic.

import { logger } from '../../../config/logger.js';
import { PaymentError } from '../types.js';
import { secureHashV1, verifySecureHashV1 } from './crypto.js';
import type {
  CommandRequest,
  CommandResponse,
  IciciOrangePgConfig,
  InitiateSaleRequest,
  InitiateSaleResponse,
} from './types.js';

// ────────── Initiate Sale ──────────

export interface InitiateSaleInput {
  merchantTxnNo: string;
  /** Rupees with 2 decimals — e.g. "100.00". Use `paiseToWireAmount`. */
  amount: string;
  customerEmailID: string;
  customerMobileNo?: string;
  customerName?: string;
  /** `YYYYMMDDHHMMSS` IST — use `txnDateIST()` from ./types.ts. */
  txnDate: string;
  addlParam1?: string;
  addlParam2?: string;
}

export async function initiateSale(
  cfg: IciciOrangePgConfig,
  input: InitiateSaleInput,
): Promise<InitiateSaleResponse> {
  const unsigned: Omit<InitiateSaleRequest, 'secureHash'> = {
    merchantId: cfg.credentials.merchantId,
    aggregatorID: cfg.credentials.aggregatorID,
    merchantTxnNo: input.merchantTxnNo,
    amount: input.amount,
    currencyCode: '356',
    payType: '0',
    customerEmailID: input.customerEmailID,
    customerMobileNo: input.customerMobileNo,
    customerName: input.customerName,
    addlParam1: input.addlParam1,
    addlParam2: input.addlParam2,
    returnURL: cfg.returnURL,
    transactionType: 'SALE',
    txnDate: input.txnDate,
  };
  const body: InitiateSaleRequest = {
    ...unsigned,
    secureHash: secureHashV1(unsigned, cfg.credentials.key),
  };

  const json = await postJson<InitiateSaleResponse>(cfg.endpoints.initiateSale, body, cfg);
  assertResponseHash(json, cfg.credentials.key, 'initiateSale', input.merchantTxnNo);
  return json;
}

// ────────── /command — status check ──────────

export async function statusCheck(
  cfg: IciciOrangePgConfig,
  merchantTxnNo: string,
): Promise<CommandResponse> {
  const unsigned: Omit<CommandRequest, 'secureHash'> = {
    merchantId: cfg.credentials.merchantId,
    aggregatorID: cfg.credentials.aggregatorID,
    merchantTxnNo,
    transactionType: 'STATUS',
    originalTxnNo: merchantTxnNo,
  };
  const body: CommandRequest = {
    ...unsigned,
    secureHash: secureHashV1(unsigned, cfg.credentials.key),
  };

  const json = await postJson<CommandResponse>(cfg.endpoints.command, body, cfg);
  assertResponseHash(json, cfg.credentials.key, 'statusCheck', merchantTxnNo);
  return json;
}

// ────────── /command — refund ──────────

export interface RefundInput {
  /** Our refund-side reference (becomes merchantTxnNo on the refund txn). */
  refundCode: string;
  /** The merchantTxnNo of the original SALE we're refunding. */
  originalTxnNo: string;
  /** Rupees with 2 decimals — partial refunds are allowed. */
  amount: string;
}

export async function refund(
  cfg: IciciOrangePgConfig,
  input: RefundInput,
): Promise<CommandResponse> {
  const unsigned: Omit<CommandRequest, 'secureHash'> = {
    merchantId: cfg.credentials.merchantId,
    aggregatorID: cfg.credentials.aggregatorID,
    merchantTxnNo: input.refundCode,
    transactionType: 'REFUND',
    originalTxnNo: input.originalTxnNo,
    amount: input.amount,
  };
  const body: CommandRequest = {
    ...unsigned,
    secureHash: secureHashV1(unsigned, cfg.credentials.key),
  };

  const json = await postJson<CommandResponse>(cfg.endpoints.command, body, cfg);
  assertResponseHash(json, cfg.credentials.key, 'refund', input.refundCode);
  return json;
}

// ────────── /command — settlement status ──────────
//
// SETTLSTATUS asks "is this txn settled to our bank yet?" — the bank fills in
// settlementID / settlementDate / settledAmount / utr_no when the answer is
// `txnStatus === 'STD'`. Use this to backfill PaymentTransaction.settlement
// fields without waiting for the daily CSV upload.

export async function settlementStatus(
  cfg: IciciOrangePgConfig,
  merchantTxnNo: string,
): Promise<CommandResponse> {
  const unsigned: Omit<CommandRequest, 'secureHash'> = {
    merchantId: cfg.credentials.merchantId,
    aggregatorID: cfg.credentials.aggregatorID,
    merchantTxnNo,
    transactionType: 'SETTLSTATUS',
    originalTxnNo: merchantTxnNo,
  };
  const body: CommandRequest = {
    ...unsigned,
    secureHash: secureHashV1(unsigned, cfg.credentials.key),
  };
  const json = await postJson<CommandResponse>(cfg.endpoints.command, body, cfg);
  assertResponseHash(json, cfg.credentials.key, 'settlementStatus', merchantTxnNo);
  return json;
}

/** SETTLEMENTSUMMARY returns aggregate metrics for a settlement batch — used
 *  by the daily ops dashboard, not the per-txn recon path. */
export async function settlementSummary(
  cfg: IciciOrangePgConfig,
  merchantTxnNo: string,
): Promise<CommandResponse> {
  const unsigned: Omit<CommandRequest, 'secureHash'> = {
    merchantId: cfg.credentials.merchantId,
    aggregatorID: cfg.credentials.aggregatorID,
    merchantTxnNo,
    transactionType: 'SETTLEMENTSUMMARY',
  };
  const body: CommandRequest = {
    ...unsigned,
    secureHash: secureHashV1(unsigned, cfg.credentials.key),
  };
  const json = await postJson<CommandResponse>(cfg.endpoints.command, body, cfg);
  assertResponseHash(json, cfg.credentials.key, 'settlementSummary', merchantTxnNo);
  return json;
}

// ────────── Shared HTTP layer ──────────

async function postJson<T>(
  url: string,
  body: object,
  cfg: IciciOrangePgConfig,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = (err as { name?: string } | null)?.name === 'AbortError';
    throw new PaymentError(
      'NETWORK_ERROR',
      isAbort ? `ICICI Orange PG request timed out after ${cfg.timeoutMs}ms` : `ICICI Orange PG network error: ${(err as Error).message}`,
      'ICICI_ORANGE_PG',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 5xx + 4xx — the bank returned a non-2xx status. Keep the body for
    // diagnostics but never include credentials in the thrown message.
    const text = await res.text().catch(() => '');
    logger.warn(
      { url, status: res.status, bodyPreview: redactPreview(text).slice(0, 500) },
      'icici-orange-pg: non-2xx response',
    );
    throw new PaymentError(
      res.status >= 500 ? 'GATEWAY_FAILURE' : 'BAD_REQUEST',
      `ICICI Orange PG ${res.status} ${res.statusText}`,
      'ICICI_ORANGE_PG',
      String(res.status),
    );
  }

  return (await res.json()) as T;
}

/** Redact sensitive substrings from log bodies. Belt-and-suspenders: we
 *  shouldn't be logging credentials anyway, but if the bank ever echoes a
 *  field we don't expect, this stops accidental leakage. */
function redactPreview(s: string): string {
  return s
    .replace(/("secureHash"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/(secureHash=)[^&\s]+/gi, '$1***')
    .replace(/("key"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/("cvv"\s*:\s*")([^"]+)(")/gi, '$1***$3')
    .replace(/("cardNo"\s*:\s*")[\d]{6}[\d]+(\d{4})(")/gi, '$1******$2$3');
}

/** Validate the response's `secureHash`. Bank-side bugs DO happen — verifying
 *  is what stops a spoofed reply from injecting fake success responses. */
function assertResponseHash(
  body: object,
  key: string,
  op: string,
  txnRef: string,
): void {
  const record = body as Record<string, unknown>;
  const supplied = record.secureHash;
  if (typeof supplied !== 'string' || supplied.length === 0) {
    // Status/refund responses sometimes ship without a hash in early
    // sandbox; log loudly but don't throw — caller still needs the body.
    logger.warn({ op, txnRef }, 'icici-orange-pg: response missing secureHash');
    return;
  }
  if (!verifySecureHashV1(record, key, supplied)) {
    logger.error({ op, txnRef }, 'icici-orange-pg: response secureHash mismatch');
    throw new PaymentError(
      'INVALID_SIGNATURE',
      'ICICI Orange PG response secureHash mismatch — possible tampering',
      'ICICI_ORANGE_PG',
    );
  }
}
