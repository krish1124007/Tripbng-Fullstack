// ICICI Orange PG / Pay Gateway — return-URL + payment-advice parsers.
//
// The return URL (browser POST) and the payment advice (server-to-server)
// carry essentially the same payload. The advice MAY arrive as either
// `application/x-www-form-urlencoded` OR `application/json` depending on
// the merchant onboarding flag. We accept both.
//
// Hash verification (V1) is the FIRST thing we do. Without it, an attacker
// can forge any field — including `responseCode: '000'` — and credit a
// wallet for free. Verify, then read.

import type { ReturnUrlPayload } from './types.js';
import { verifySecureHashV1 } from './crypto.js';

export interface ParsedGatewayCallback {
  signatureValid: boolean;
  payload: ReturnUrlPayload;
  /** True iff the parser recognised the body as form-encoded (return URL)
   *  rather than JSON (some advice configurations). Useful for logs. */
  contentType: 'form' | 'json';
}

/** Parse a URL-encoded body (the standard return URL shape) and verify
 *  its secureHash against the merchant key. */
export function parseReturnUrl(rawBody: string, merchantKey: string): ParsedGatewayCallback {
  const flat = urlencodedToFlatRecord(rawBody);
  return verifyAndShape(flat, merchantKey, 'form');
}

/** Parse a payment-advice body. Accepts both form-encoded and JSON —
 *  the content-type comes in from the Express route's middleware. */
export function parseAdvice(
  rawBody: string,
  contentType: string | undefined,
  merchantKey: string,
): ParsedGatewayCallback {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      // Malformed JSON — treat as empty so signatureValid=false.
    }
    const flat = flattenStrings(json);
    return verifyAndShape(flat, merchantKey, 'json');
  }
  return parseReturnUrl(rawBody, merchantKey);
}

// ────────── internals ──────────

function urlencodedToFlatRecord(rawBody: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(rawBody);
  params.forEach((v, k) => {
    // Last value wins on dupes — matches Express's qs.parse(extended=false).
    out[k] = v;
  });
  return out;
}

function flattenStrings(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

function verifyAndShape(
  flat: Record<string, string>,
  merchantKey: string,
  contentType: 'form' | 'json',
): ParsedGatewayCallback {
  const supplied = flat.secureHash;
  const signatureValid = verifySecureHashV1(flat, merchantKey, supplied);
  const payload: ReturnUrlPayload = {
    merchantId: flat.merchantId ?? '',
    merchantTxnNo: flat.merchantTxnNo ?? '',
    amount: flat.amount ?? '',
    currencyCode: flat.currencyCode ?? '',
    responseCode: flat.responseCode ?? '',
    respDescription: flat.respDescription,
    txnID: flat.txnID,
    paymentID: flat.paymentID,
    paymentMode: flat.paymentMode,
    paymentSubInstType: flat.paymentSubInstType,
    paymentDateTime: flat.paymentDateTime,
    secureHash: flat.secureHash ?? '',
    ...flat,
  };
  return { signatureValid, payload, contentType };
}
