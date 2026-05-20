// ICICI Orange PG / Pay Gateway — wire types + response-code map.
//
// All amounts are sent as strings with 2 decimals ("100.00"), NOT paise.
// All txnDate values are IST `YYYYMMDDHHMMSS`. currencyCode is "356" (INR).
// `secureHash` is V1 lowercase hex; see ./crypto.ts.

// ────────── Credentials + config ──────────

export interface IciciOrangePgCredentials {
  merchantId: string;
  /** Aggregator-mode merchants must always send `aggregatorID`. We are one. */
  aggregatorID: string;
  /** Merchant key — the HMAC secret. Server-side only; NEVER ship to FE. */
  key: string;
}

export interface IciciOrangePgEndpoints {
  initiateSale: string;
  command: string;
  settlementDetails: string;
  userCancel: string;
}

export interface IciciOrangePgConfig {
  credentials: IciciOrangePgCredentials;
  endpoints: IciciOrangePgEndpoints;
  /** Where the bank POSTs the customer back to (UX). */
  returnURL: string;
  /** Where the bank POSTs the server-to-server advice (authoritative). */
  adviceURL: string;
  timeoutMs: number;
}

// ────────── Initiate Sale ──────────

export interface InitiateSaleRequest {
  merchantId: string;
  aggregatorID: string;
  /** Alphanumeric, ≤ 20 chars per spec. No hyphens/underscores. */
  merchantTxnNo: string;
  /** Rupees with 2 decimals as a string ("100.00"). */
  amount: string;
  /** Always "356" for INR. */
  currencyCode: '356';
  /** "0" = Standard/redirect (we always use this — Direct/Seamless is PCI). */
  payType: '0';
  customerEmailID: string;
  customerMobileNo?: string;
  customerName?: string;
  addlParam1?: string;
  addlParam2?: string;
  returnURL: string;
  transactionType: 'SALE';
  /** `YYYYMMDDHHMMSS` in IST (Asia/Kolkata). */
  txnDate: string;
  secureHash: string;
}

export interface InitiateSaleResponse {
  /** "R1000" on success (redirect to bank). */
  responseCode: string;
  respDescription?: string;
  /** Bank-side context token. Append as `?tranCtx=...` to the redirect URI. */
  tranCtx?: string;
  /** The full redirect URL the customer should be sent to. */
  redirectURI?: string;
  /** Echo of merchantTxnNo. */
  merchantTxnNo?: string;
  secureHash?: string;
}

// ────────── /command — status, refund, settlement ──────────

export type CommandTransactionType =
  | 'STATUS'
  | 'REFUND'
  | 'SETTLSTATUS'
  | 'SETTLEMENTSUMMARY';

export interface CommandRequest {
  merchantId: string;
  aggregatorID: string;
  merchantTxnNo: string;
  transactionType: CommandTransactionType;
  /** Same as merchantTxnNo for STATUS; original SALE txn for REFUND. */
  originalTxnNo?: string;
  /** REFUND only — string rupees ("50.00"). */
  amount?: string;
  secureHash: string;
}

export interface CommandResponse {
  responseCode: string;
  respDescription?: string;
  merchantTxnNo?: string;
  originalTxnNo?: string;
  /** Bank-side payment txn id. */
  txnID?: string;
  paymentID?: string;
  /** "SUC" = success, "FAL" = failed, "PND" = pending. */
  txnStatus?: 'SUC' | 'FAL' | 'PND' | string;
  amount?: string;
  paymentMode?: PaymentModeValue;
  paymentSubInstType?: string;
  paymentDateTime?: string;
  /** Settlement fields populated only on SETTLSTATUS / SETTLEMENTSUMMARY. */
  settlementID?: string;
  settlementDate?: string;
  settledAmount?: string;
  utr_no?: string;
  secureHash?: string;
}

// ────────── Return URL + Payment Advice ──────────

/** The bank POSTs these fields back to our return URL (urlencoded). The
 *  Payment Advice handler receives essentially the same shape (sometimes JSON,
 *  configured per-merchant). Hash always V1, excluding `secureHash` itself. */
export interface ReturnUrlPayload {
  merchantId: string;
  merchantTxnNo: string;
  amount: string;
  currencyCode: string;
  /** "000" or "0000" = success. Anything else = failure. */
  responseCode: string;
  respDescription?: string;
  txnID?: string;
  paymentID?: string;
  paymentMode?: PaymentModeValue;
  paymentSubInstType?: string;
  paymentDateTime?: string;
  secureHash: string;
  /** Anything extra the bank may attach — kept for forensic replay. */
  [key: string]: string | undefined;
}

export type PaymentModeValue = 'CARD' | 'NB' | 'UPI' | 'WALLET' | string;

// ────────── Response code map ──────────
//
// `responseCode` semantics. `000` / `0000` mean success. `R1000` is the
// transient "initiated, redirecting" state from initiateSale.
//
// Failure codes are NOT enumerated in the PDF — they're observed in UAT.
// Treat any unknown code as `retryable: false` and surface the raw
// `respDescription` to admins. The end-user gets a generic
// "Payment failed, please try again" message.

export interface ResponseCodeMeta {
  status: 'SUCCESS' | 'INITIATED' | 'FAILED' | 'PENDING' | 'UNKNOWN';
  /** Safe to show to the agent — no internal jargon. */
  userMessage: string;
  retryable: boolean;
}

export const ORANGE_PG_CODES: Record<string, ResponseCodeMeta> = {
  '000': { status: 'SUCCESS', userMessage: 'Payment successful', retryable: false },
  '0000': { status: 'SUCCESS', userMessage: 'Payment successful', retryable: false },
  R1000: { status: 'INITIATED', userMessage: 'Redirecting to bank…', retryable: false },
  // Populate failure codes as observed in UAT — keep them centralised here.
} as const;

export function describeResponseCode(code: string | undefined | null): ResponseCodeMeta {
  if (!code) {
    return {
      status: 'UNKNOWN',
      userMessage: 'Payment status unknown — please refresh in a minute.',
      retryable: false,
    };
  }
  return (
    ORANGE_PG_CODES[code] ?? {
      status: 'FAILED',
      userMessage: 'Payment failed — please try again or use a different method.',
      retryable: false,
    }
  );
}

export function isSuccessCode(code: string | undefined | null): boolean {
  if (!code) return false;
  return code === '000' || code === '0000';
}

// ────────── Helpers ──────────

/** Build a `YYYYMMDDHHMMSS` string in IST. ICICI servers are IST-anchored;
 *  using UTC will produce date-mismatch failures for evening transactions. */
export function txnDateIST(now: Date = new Date()): string {
  // Format date components in IST without depending on the host's TZ.
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // en-GB → "DD/MM/YYYY, HH:MM:SS"
  const parts = fmt.formatToParts(now);
  const lookup = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return (
    lookup('year') +
    lookup('month') +
    lookup('day') +
    lookup('hour') +
    lookup('minute') +
    lookup('second')
  );
}

/** Convert paise (integer) to the wire format ICICI expects (rupees with
 *  2 decimals as a string). `12345` → `"123.45"`. */
export function paiseToWireAmount(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`invalid paise amount: ${paise}`);
  }
  return (paise / 100).toFixed(2);
}

/** Strip everything but [A-Za-z0-9] from a txn code — the spec restricts
 *  merchantTxnNo to alphanumeric, max 20 chars. Our PT codes are already
 *  alphanumeric (`PT0001234`) but this guards against future drift. */
export function sanitiseMerchantTxnNo(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9]/g, '');
  if (clean.length === 0) throw new Error(`txnCode reduces to empty: ${s}`);
  return clean.slice(0, 20);
}
