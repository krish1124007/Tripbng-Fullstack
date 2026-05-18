// Policy service — orchestrates `createPolicy/validate` (preview) and
// `createPolicy` (live issue with encrypted body). Persists every result to
// Mongo (Policy + PolicyEvent) so we never rely on ASEGO as the single source
// of truth, and so support has an audit trail when something goes wrong.
//
// Idempotency: `orderId` is computed from the optional bookingId (when
// supplied) or a fresh UUID. Mongo enforces (tenantId, orderId) unique — if
// we somehow retry the same orderId after a successful issue, the second
// insert hits the dup-key error and we surface the original policy.

import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import {
  AppError,
  type InsuranceIssueRequest,
  type InsuranceIssueResponse,
  type InsuranceValidateRequest,
} from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { describeAsegoError } from '../../adapters/asego/constants.js';
import { encryptForAsego } from '../../adapters/asego/crypto.js';
import { AsegoError } from '../../adapters/asego/errors.js';
import type { AsegoIdentityConfig } from '../../adapters/asego/identity.js';
import { InsurancePolicy } from '../../models/InsurancePolicy.js';
import { InsurancePolicyEvent } from '../../models/InsurancePolicyEvent.js';
import { getAsegoContext } from './asego.singleton.js';
import { mapToExternalPolicies, redactPolicyForAudit } from './mapper.js';
import { Actor, EVENTS, track } from '../analytics.service.js';
import { enqueueAlert } from '../alerts/index.js';

export interface PolicyContext {
  tenantId: string;
  userId: string;
}

interface ValidateResponse {
  valid: boolean;
  warnings: string[];
  raw?: unknown;
}

/** Validate accepts the SAME ExternalPolicy[] array as createPolicy and is
 *  ALSO encrypted per the OpenAPI spec (request body schema is `string`). */
function buildValidatePolicies(
  req: InsuranceValidateRequest,
  identityCfg: AsegoIdentityConfig,
): import('../../adapters/asego/types.js').ExternalPolicy[] {
  const orderId = randomUUID().replace(/-/g, '').slice(0, 32);
  return mapToExternalPolicies(
    {
      ...req,
      promoCode: '',
      remarks: '',
    },
    identityCfg,
    orderId,
  );
}

/**
 * POST /createPolicy/validate/{partnerId} — pre-flight check before charging
 * the customer. Plaintext JSON, returns `{ valid, msg }` shape (we treat any
 * 200 response as success and surface ASEGO's msg as a warning when present).
 */
export async function validatePolicyDraft(
  ctx: PolicyContext,
  req: InsuranceValidateRequest,
): Promise<ValidateResponse> {
  const asego = getAsegoContext();
  if (!asego)
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });

  const policies = buildValidatePolicies(req, asego.identity);
  const ciphertext = encryptForAsego(policies);
  const startedAt = Date.now();
  let response: unknown;
  let asegoStatus: number | null = null;
  let errorCode: string | null = null;
  let errorMsg: string | null = null;

  try {
    response = await asego.client.post<object, unknown>(
      `/createPolicy/validate/${asego.identity.partnerId}`,
      {},
      { rawBody: ciphertext, contentType: 'text/plain', noRetry: true },
    );
    asegoStatus = 200;
  } catch (err) {
    if (err instanceof AsegoError) {
      asegoStatus = err.httpStatus;
      errorCode = err.code;
      errorMsg = err.message;
      response = err.asegoBody ?? null;
    } else {
      errorCode = 'TRANSPORT_ERROR';
      errorMsg = err instanceof Error ? err.message : 'unknown';
    }
  }

  await InsurancePolicyEvent.create({
    tenantId: new Types.ObjectId(ctx.tenantId),
    orderId: 'validate-' + Date.now(),
    eventType: 'VALIDATE',
    request: policies.map(redactPolicyForAudit),
    response,
    asegoStatusCode: asegoStatus,
    errorCode,
    errorMsg,
    durationMs: Date.now() - startedAt,
    triggeredBy: new Types.ObjectId(ctx.userId),
  }).catch((auditErr) => {
    logger.warn({ err: auditErr }, 'failed to write validate audit event');
  });

  if (errorCode) {
    const desc = describeAsegoError(errorCode, errorMsg ?? '');
    throw new AppError('VALIDATION_ERROR', {
      reason: desc.message,
      asegoCode: errorCode,
      asegoRawMsg: errorMsg,
      retry: desc.retry,
    });
  }

  // 200 response — extract `msg`/`warnings` if ASEGO provides them.
  const warnings: string[] = [];
  if (response && typeof response === 'object') {
    const r = response as { msg?: unknown; warnings?: unknown };
    if (typeof r.msg === 'string') warnings.push(r.msg);
    if (Array.isArray(r.warnings))
      warnings.push(...r.warnings.filter((w): w is string => typeof w === 'string'));
  }
  return { valid: true, warnings, raw: response };
}

/**
 * POST /createPolicy/{partnerId} — the only ASEGO endpoint that requires an
 * AES-256-CBC + Base64 encrypted body. Returns one policy per traveler in the
 * request; Mongo persistence happens on success only.
 */
export async function issuePolicy(
  ctx: PolicyContext,
  req: InsuranceIssueRequest,
): Promise<InsuranceIssueResponse> {
  const asego = getAsegoContext();
  if (!asego)
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });

  // orderId — booking id when present (deterministic, dedup-friendly), else fresh UUID.
  const orderId = req.bookingId
    ? `tb-${req.bookingId}`.slice(0, 32)
    : randomUUID().replace(/-/g, '').slice(0, 32);

  // Idempotency check — if this orderId already produced a policy for this tenant,
  // return the persisted result instead of double-charging via ASEGO.
  const existing = await InsurancePolicy.findOne({
    tenantId: new Types.ObjectId(ctx.tenantId),
    orderId,
  }).lean();
  if (existing) {
    logger.info(
      { orderId, policyNumber: existing.policyNumber },
      'asego issue: returning cached policy',
    );
    return {
      policyNumbers: [existing.policyNumber],
      downloadUrls: [`/api/v1/insurance/policy/${existing.policyNumber}/pdf`],
      totalPremiumPaise: existing.totalPremiumPaise,
      currency: existing.currency,
    };
  }

  // Build ExternalPolicy[] (one entry per traveler) and encrypt for the wire.
  const policies = mapToExternalPolicies(req, asego.identity, orderId);
  const ciphertext = encryptForAsego(policies);

  const startedAt = Date.now();
  let response: unknown;
  let asegoStatus: number | null = null;
  let errorCode: string | null = null;
  let errorMsg: string | null = null;

  try {
    // Encrypted body: send as raw text under the same content type.
    // ASEGO accepts the ciphertext directly in the request body.
    response = await asego.client.post<object, unknown>(
      `/createPolicy/${asego.identity.partnerId}`,
      {},
      { rawBody: ciphertext, contentType: 'text/plain', noRetry: true },
    );
    asegoStatus = 200;
  } catch (err) {
    if (err instanceof AsegoError) {
      asegoStatus = err.httpStatus;
      errorCode = err.code;
      errorMsg = err.message;
      response = err.asegoBody ?? null;
    } else {
      errorCode = 'TRANSPORT_ERROR';
      errorMsg = err instanceof Error ? err.message : 'unknown';
    }
  }

  await InsurancePolicyEvent.create({
    tenantId: new Types.ObjectId(ctx.tenantId),
    orderId,
    eventType: 'ISSUE',
    request: policies.map(redactPolicyForAudit),
    response,
    asegoStatusCode: asegoStatus,
    errorCode,
    errorMsg,
    durationMs: Date.now() - startedAt,
    triggeredBy: new Types.ObjectId(ctx.userId),
  }).catch((auditErr) => {
    logger.warn({ err: auditErr, orderId }, 'failed to write issue audit event');
  });

  if (errorCode) {
    const desc = describeAsegoError(errorCode, errorMsg ?? '');
    // 5xx + transport errors → SUPPLIER_UNAVAILABLE (503) so callers can retry.
    // 4xx with a "never" retry hint → VALIDATION_ERROR (400) so the user fixes it.
    const code = desc.retry === 'transient' ? 'SUPPLIER_UNAVAILABLE' : 'VALIDATION_ERROR';
    throw new AppError(code, {
      reason: desc.message,
      asegoCode: errorCode,
      asegoRawMsg: errorMsg,
      retry: desc.retry,
    });
  }

  // Parse the response — ASEGO returns either an array (one per traveler) or
  // a `{ policies: [...] }` envelope. Normalize.
  const issued = extractIssuedPolicies(response);
  if (issued.length === 0) {
    logger.warn({ response }, 'asego issue returned 200 but no policies parsed');
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO returned no policies' });
  }

  // Persist each issued policy. We use `bulkWrite` with `ordered: false` so a
  // single duplicate doesn't kill the whole insert.
  const docs = issued.map((p, i) => ({
    tenantId: new Types.ObjectId(ctx.tenantId),
    bookingId: req.bookingId ? new Types.ObjectId(req.bookingId) : null,
    orderId: i === 0 ? orderId : `${orderId}-${i}`,
    policyNumber: p.policyNumber,
    policyFilePath: p.policyFilePath ?? null,
    status: 'ISSUED' as const,
    insurerId: req.selectedPlan.insurerId,
    insurerName: req.selectedPlan.insurerName ?? null,
    planId: req.selectedPlan.planId,
    planName: req.selectedPlan.planName ?? null,
    sellingPlanId: req.selectedPlan.sellingPlanId,
    travelerSnapshot: req.travelers[i] ?? null,
    quotationSnapshot: req.quotation,
    selectedPlanSnapshot: req.selectedPlan,
    totalPremiumPaise: req.selectedPlan.totalPremiumPaise,
    currency: 'INR',
    createdBy: new Types.ObjectId(ctx.userId),
  }));
  await InsurancePolicy.insertMany(docs, { ordered: false }).catch((err) => {
    // Non-fatal — ASEGO has already issued the policy; lost-Mongo-write is a
    // recovery problem, not a customer problem. Log loudly so ops can backfill.
    logger.error({ err, orderId }, 'INSURANCE-POLICY-PERSIST-FAILED — backfill required');
  });

  track({
    event: EVENTS.INSURANCE_ISSUED,
    distinctId: Actor.user(ctx.userId),
    properties: {
      order_id: orderId,
      policy_count: issued.length,
      policy_numbers: issued.map((p) => p.policyNumber),
      insurer_name: req.selectedPlan.insurerName ?? null,
      plan_name: req.selectedPlan.planName ?? null,
      premium_paise: req.selectedPlan.totalPremiumPaise,
      booking_id: req.bookingId ?? null,
      tenant_id: ctx.tenantId,
    },
  });

  // Multi-channel alert. We send to the user who issued the policy; if a
  // bookingId is attached we ALSO send to the booking_contact so customers
  // who buy insurance bundled with a flight get the policy paperwork.
  void enqueueAlert(
    {
      event: 'INSURANCE_ISSUED',
      vars: {
        policyNumbers: issued.map((p) => p.policyNumber),
        insurerName: req.selectedPlan.insurerName ?? 'TripBng Insurance',
        premiumPaise: req.selectedPlan.totalPremiumPaise,
        bookingCode: req.bookingId ? null : null, // bookingCode would need a Booking lookup; skip for v1
      },
    },
    req.bookingId
      ? [
          { kind: 'user', id: ctx.userId },
          { kind: 'booking_contact', bookingId: req.bookingId },
        ]
      : [{ kind: 'user', id: ctx.userId }],
    {
      tenantId: ctx.tenantId,
      correlationKey: `insurance:${orderId}`,
    },
  );

  return {
    policyNumbers: issued.map((p) => p.policyNumber),
    downloadUrls: issued.map((p) => `/api/v1/insurance/policy/${p.policyNumber}/pdf`),
    totalPremiumPaise: req.selectedPlan.totalPremiumPaise,
    currency: 'INR',
  };
}

interface IssuedPolicy {
  policyNumber: string;
  policyFilePath?: string;
}

function extractIssuedPolicies(response: unknown): IssuedPolicy[] {
  if (!response) return [];
  // Direct array shape
  if (Array.isArray(response)) {
    return response.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const e = entry as { policyNumber?: unknown; policyFilePath?: unknown };
      if (typeof e.policyNumber !== 'string') return [];
      return [
        {
          policyNumber: e.policyNumber,
          policyFilePath: typeof e.policyFilePath === 'string' ? e.policyFilePath : undefined,
        },
      ];
    });
  }
  // Envelope shape `{ policies: [...] }`
  if (typeof response === 'object') {
    const r = response as { policies?: unknown; data?: unknown };
    if (Array.isArray(r.policies)) return extractIssuedPolicies(r.policies);
    if (Array.isArray(r.data)) return extractIssuedPolicies(r.data);
    // Single policy object
    const single = response as { policyNumber?: unknown; policyFilePath?: unknown };
    if (typeof single.policyNumber === 'string') {
      return [
        {
          policyNumber: single.policyNumber,
          policyFilePath:
            typeof single.policyFilePath === 'string' ? single.policyFilePath : undefined,
        },
      ];
    }
  }
  return [];
}
