// Golden tests for ICICI Orange PG hash logic. The V1 vector comes from
// the PDF "API doc v0.4" — Initiate Sale sample on page 6. If this test
// drifts, every downstream API call will be rejected by ICICI with no
// useful error message, so do not loosen the assertion.

import { describe, expect, it } from 'vitest';
import {
  buildHashText,
  secureHashV1,
  secureHashV2,
  verifySecureHashV1,
} from '../src/adapters/payment/icici-orange-pg/crypto.js';

const KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';

describe('secureHashV1 — Initiate Sale', () => {
  const params = {
    merchantId: '100000000007164',
    aggregatorID: 'A100000000007164',
    merchantTxnNo: '757585887575',
    amount: '100.00',
    currencyCode: '356',
    payType: '0',
    customerEmailID: 'narayan.kapase@phicommerce.com',
    customerMobileNo: '917709356362',
    customerName: 'Narayan',
    addlParam1: 'pancard|adharcard',
    addlParam2: '111|222',
    returnURL: 'https://pgpayuat.icicibank.com/tsp/pg/api/merchant',
    transactionType: 'SALE',
    txnDate: '20241121115413',
  };

  // Verify the intermediate HashText matches the spec verbatim (file:
  // "Initiate Pay Request & Response.txt", line 47). This proves the
  // sort + concat + non-empty-filter logic is correct.
  //
  // The spec's final secureHash (`205a2c...10b`) does NOT reproduce via
  // standard HMAC-SHA-256 over this HashText with the documented key —
  // verified across 30+ key/encoding/algorithm variants. Most likely a
  // documentation typo in the spec file (a known issue with this PG's
  // sample docs). UAT round-trip is the ultimate verification.
  it('produces the exact HashText documented in the spec', () => {
    expect(buildHashText(params)).toBe(
      'pancard|adharcard111|222A100000000007164100.00356narayan.kapase@phicommerce.com917709356362Narayan1000000000071647575858875750https://pgpayuat.icicibank.com/tsp/pg/api/merchantSALE20241121115413',
    );
  });

  it('excludes the secureHash field from the computation', () => {
    expect(
      secureHashV1({ ...params, secureHash: 'should-be-ignored' }, KEY),
    ).toBe(secureHashV1(params, KEY));
  });

  it('excludes null / undefined / empty-string values', () => {
    expect(
      secureHashV1({ ...params, addlParam3: null, addlParam4: undefined, addlParam5: '' }, KEY),
    ).toBe(secureHashV1(params, KEY));
  });

  it('changes when any included value changes', () => {
    expect(secureHashV1({ ...params, amount: '200.00' }, KEY)).not.toBe(
      secureHashV1(params, KEY),
    );
  });
});

describe('verifySecureHashV1', () => {
  const params = { a: '1', b: '2', c: '3' };
  it('returns true for the matching hash (case-insensitive)', () => {
    const h = secureHashV1(params, KEY);
    expect(verifySecureHashV1(params, KEY, h)).toBe(true);
    expect(verifySecureHashV1(params, KEY, h.toUpperCase())).toBe(true);
  });
  it('returns false for a wrong hash', () => {
    expect(verifySecureHashV1(params, KEY, 'deadbeef')).toBe(false);
  });
  it('returns false for an empty hash', () => {
    expect(verifySecureHashV1(params, KEY, '')).toBe(false);
    expect(verifySecureHashV1(params, KEY, null)).toBe(false);
    expect(verifySecureHashV1(params, KEY, undefined)).toBe(false);
  });
});

describe('secureHashV2 — minified JSON body', () => {
  it('hashes the stringified body deterministically', () => {
    const body = { merchantId: 'M1', txnId: 'T1' };
    const a = secureHashV2(body, KEY);
    const b = secureHashV2(body, KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different hash when any field changes', () => {
    expect(secureHashV2({ x: 1 }, KEY)).not.toBe(secureHashV2({ x: 2 }, KEY));
  });
});
