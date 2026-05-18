// Identity object builder. Every transactional ASEGO call needs this block —
// `partnerId` + `sign` + `reference` authenticate the caller, and `orderId`
// is the natural idempotency key (a retried request with the same orderId
// returns ASEGO's `Duplicate Record Found` 400, not a second policy).
//
// Convention: pass the TripBng booking id (or a deterministic derivative) as
// `orderId` when issuing a policy so retries are safe by construction.

import { randomUUID } from 'node:crypto';

export interface AsegoIdentity {
  orderId: string;
  sign: string;
  branchSign?: string;
  branchName?: string;
  reference: string;
  partnerId: string;
}

export interface AsegoIdentityConfig {
  partnerId: string;
  sign: string;
  reference: string;
  branchSign?: string;
  branchName?: string;
}

/** Read identity creds from env. Returns null if not configured (insurance disabled). */
export function readAsegoIdentityConfig(): AsegoIdentityConfig | null {
  const partnerId = process.env.ASEGO_PARTNER_ID;
  const sign = process.env.ASEGO_SIGN;
  const reference = process.env.ASEGO_REFERENCE;
  if (!partnerId || !sign || !reference) return null;
  return {
    partnerId,
    sign,
    reference,
    branchSign: process.env.ASEGO_BRANCH_SIGN || undefined,
    branchName: process.env.ASEGO_BRANCH_NAME || undefined,
  };
}

/**
 * Build an identity block. Caller passes `orderId` for transactional calls
 * (issue/endorse/cancel) so it can be tied back to a TripBng booking; for
 * non-idempotent helpers (validate, parity probes) we fall back to a fresh
 * UUID-derived 32-char alphanumeric string.
 */
export function buildIdentity(cfg: AsegoIdentityConfig, orderId?: string): AsegoIdentity {
  return {
    orderId: orderId ?? randomUUID().replace(/-/g, '').slice(0, 32),
    sign: cfg.sign,
    branchSign: cfg.branchSign,
    branchName: cfg.branchName,
    reference: cfg.reference,
    partnerId: cfg.partnerId,
  };
}
