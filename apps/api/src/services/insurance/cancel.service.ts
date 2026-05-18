// Cancel service — `POST /cancelPolicy/{partnerId}`. Plain JSON (NOT
// encrypted, per OpenAPI). Looks up the persisted policy, sends ASEGO the
// identity + policyNumber + reason array, updates Mongo on success, audits
// every attempt.

import { Types } from 'mongoose';
import { AppError, type InsuranceCancelRequest } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { describeAsegoError } from '../../adapters/asego/constants.js';
import { AsegoError } from '../../adapters/asego/errors.js';
import { buildIdentity } from '../../adapters/asego/identity.js';
import type { ExternalCancelPolicy } from '../../adapters/asego/types.js';
import { InsurancePolicy } from '../../models/InsurancePolicy.js';
import { InsurancePolicyEvent } from '../../models/InsurancePolicyEvent.js';
import { getAsegoContext } from './asego.singleton.js';

export interface CancelContext {
  tenantId: string;
  userId: string;
}

export interface CancelResponse {
  ok: true;
  policyNumber: string;
  cancellationCharges: number | null;
  asegoMessage?: string;
}

export async function cancelPolicy(
  ctx: CancelContext,
  req: InsuranceCancelRequest,
): Promise<CancelResponse> {
  const asego = getAsegoContext();
  if (!asego)
    throw new AppError('SUPPLIER_UNAVAILABLE', { reason: 'ASEGO insurance not configured' });

  const tenantOid = new Types.ObjectId(ctx.tenantId);
  const policy = await InsurancePolicy.findOne({
    tenantId: tenantOid,
    policyNumber: req.policyNumber,
  });
  if (!policy) {
    throw new AppError('NOT_FOUND', { reason: `policy ${req.policyNumber} not found` });
  }
  if (policy.status === 'CANCELLED') {
    throw new AppError('VALIDATION_ERROR', { reason: 'policy already cancelled' });
  }

  // Identity orderId is per-call here — cancellation isn't tied to the original
  // booking's orderId because ASEGO already has the policy on file.
  const cancelBody: ExternalCancelPolicy = {
    identity: buildIdentity(asego.identity),
    policyNumber: req.policyNumber,
    cancellationReason: [req.reasonId],
    remark: req.remarks,
  };

  const startedAt = Date.now();
  let response: unknown;
  let asegoStatus: number | null = null;
  let errorCode: string | null = null;
  let errorMsg: string | null = null;

  try {
    response = await asego.client.post<ExternalCancelPolicy, unknown>(
      `/cancelPolicy/${asego.identity.partnerId}`,
      cancelBody,
      { noRetry: true },
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
    tenantId: tenantOid,
    policyNumber: req.policyNumber,
    orderId: policy.orderId,
    eventType: 'CANCEL',
    request: cancelBody,
    response,
    asegoStatusCode: asegoStatus,
    errorCode,
    errorMsg,
    durationMs: Date.now() - startedAt,
    triggeredBy: new Types.ObjectId(ctx.userId),
  }).catch((auditErr) => {
    logger.warn(
      { err: auditErr, policyNumber: req.policyNumber },
      'failed to write cancel audit event',
    );
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

  // Some responses include cancellationCharges + a success msg; pull both if
  // present. ASEGO returns either a SuccessResponseDto[] or a single object.
  const charges = extractCancellationCharges(response);
  const asegoMessage = extractFirstMessage(response);

  policy.status = 'CANCELLED';
  policy.cancelledAt = new Date();
  if (charges !== null) policy.cancellationRefund = charges;
  await policy.save();

  return {
    ok: true,
    policyNumber: req.policyNumber,
    cancellationCharges: charges,
    asegoMessage: asegoMessage ?? undefined,
  };
}

function extractCancellationCharges(response: unknown): number | null {
  if (!response) return null;
  const candidate = Array.isArray(response) ? response[0] : response;
  if (candidate && typeof candidate === 'object' && 'cancellationCharges' in candidate) {
    const v = (candidate as { cancellationCharges?: unknown }).cancellationCharges;
    if (typeof v === 'number') return v;
  }
  return null;
}

function extractFirstMessage(response: unknown): string | null {
  if (!response) return null;
  const candidate = Array.isArray(response) ? response[0] : response;
  if (candidate && typeof candidate === 'object' && 'msg' in candidate) {
    const v = (candidate as { msg?: unknown }).msg;
    if (typeof v === 'string') return v;
  }
  return null;
}
