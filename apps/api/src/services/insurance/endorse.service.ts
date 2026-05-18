// Endorse service — `POST /endorsePolicy/{partnerId}`. Plain JSON. ASEGO
// expects a full ExternalEndorsePolicy envelope (identity + plan + quotation
// + traveler + reason + the original policy number to endorse).
//
// Pragmatic shape: we patch the existing persisted policy with whatever
// `new*` fields the caller provided, then ship the whole envelope. Anything
// the caller didn't override stays the same as the original issue.

import { Types } from 'mongoose';
import { AppError, type InsuranceEndorseRequest } from '@tripbng/shared';
import { logger } from '../../config/logger.js';
import { describeAsegoError } from '../../adapters/asego/constants.js';
import { AsegoError } from '../../adapters/asego/errors.js';
import { buildIdentity } from '../../adapters/asego/identity.js';
import type {
  ExternalEndorsePolicy,
  ExternalEndorseQuotation,
  ExternalEndorseSelectedPlan,
  ExternalEndorseTraveler,
} from '../../adapters/asego/types.js';
import { InsurancePolicy } from '../../models/InsurancePolicy.js';
import { InsurancePolicyEvent } from '../../models/InsurancePolicyEvent.js';
import { getAsegoContext } from './asego.singleton.js';
import { computeDuration } from './mapper.js';

export interface EndorseContext {
  tenantId: string;
  userId: string;
}

export interface EndorseResponse {
  ok: true;
  policyNumber: string;
  asegoMessage?: string;
}

interface SnapshotTraveler {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  passport?: string;
  email?: string;
  mobileNo?: string;
  pincode?: string;
  address?: string;
  district?: string;
  state?: string;
  country?: string;
  nominee?: { firstName?: string; lastName?: string; relation?: string };
}

interface SnapshotQuotation {
  startDate?: string;
  endDate?: string;
  category?: string;
  destination?: string;
}

interface SnapshotSelectedPlan {
  insurerId?: string;
  planId?: string;
  sellingPlanId?: string;
  totalPremiumPaise?: number;
}

export async function endorsePolicy(
  ctx: EndorseContext,
  req: InsuranceEndorseRequest,
): Promise<EndorseResponse> {
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
    throw new AppError('VALIDATION_ERROR', { reason: 'cannot endorse a cancelled policy' });
  }

  // Pull originals from the persisted snapshot — we apply the caller's patches
  // on top so the envelope is complete even when only a few fields change.
  const origTraveler = (policy.travelerSnapshot ?? {}) as SnapshotTraveler;
  const origQuotation = (policy.quotationSnapshot ?? {}) as SnapshotQuotation;
  const origPlan = (policy.selectedPlanSnapshot ?? {}) as SnapshotSelectedPlan;

  const startDate = req.newStartDate ?? origQuotation.startDate ?? '';
  const endDate = req.newEndDate ?? origQuotation.endDate ?? '';
  if (!startDate || !endDate) {
    throw new AppError('VALIDATION_ERROR', { reason: 'endorse needs both start + end dates' });
  }

  const quotation: ExternalEndorseQuotation = {
    tripType: 'Single',
    travelCategory: origQuotation.category ?? '',
    startDate,
    duration: computeDuration(startDate, endDate),
    endDate,
    destination: origQuotation.destination,
  };

  const selectedPlan: ExternalEndorseSelectedPlan = {
    insurerId: origPlan.insurerId ?? '',
    totalPremium: (origPlan.totalPremiumPaise ?? 0) / 100,
    plan: {
      sellingPlanId: origPlan.sellingPlanId ?? '',
      agePremiums: { age: 30, premium: (origPlan.totalPremiumPaise ?? 0) / 100 },
      riders: [],
    },
  };

  const fullName = [origTraveler.firstName, origTraveler.middleName, origTraveler.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const nomineeName = origTraveler.nominee
    ? `${origTraveler.nominee.firstName ?? ''} ${origTraveler.nominee.lastName ?? ''}`.trim()
    : fullName;

  const traveler: ExternalEndorseTraveler = {
    name: fullName,
    passport: origTraveler.passport ?? '',
    dob: origTraveler.dateOfBirth ?? '',
    address: req.newAddress ?? origTraveler.address ?? '',
    mobileNo: req.newMobileNo ?? origTraveler.mobileNo ?? '',
    email: req.newEmail ?? origTraveler.email ?? '',
    city: origTraveler.district ?? '',
    district: origTraveler.district ?? '',
    state: origTraveler.state ?? '',
    pincode: origTraveler.pincode ?? '',
    country: origTraveler.country ?? '',
    age: 30,
    gender: origTraveler.gender ?? 'M',
    nominee: nomineeName,
    relation: origTraveler.nominee?.relation ?? 'Self',
    emergencyContactPerson: '',
    emergencyContactNumber: '',
    emergencyEmailId: '',
    finalPremium: (origPlan.totalPremiumPaise ?? 0) / 100,
  };

  const endorseBody: ExternalEndorsePolicy = {
    identity: buildIdentity(asego.identity),
    selectedPlan,
    quotation,
    traveler,
    otherDetails: { policyComment: req.remarks ?? '' },
    endorsementReason: [req.reasonId],
    remark: req.remarks,
    endorsePolicyNumber: req.policyNumber,
  };

  const startedAt = Date.now();
  let response: unknown;
  let asegoStatus: number | null = null;
  let errorCode: string | null = null;
  let errorMsg: string | null = null;

  try {
    response = await asego.client.post<ExternalEndorsePolicy, unknown>(
      `/endorsePolicy/${asego.identity.partnerId}`,
      endorseBody,
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
    eventType: 'ENDORSE',
    request: redactEndorseForAudit(endorseBody),
    response,
    asegoStatusCode: asegoStatus,
    errorCode,
    errorMsg,
    durationMs: Date.now() - startedAt,
    triggeredBy: new Types.ObjectId(ctx.userId),
  }).catch((auditErr) => {
    logger.warn(
      { err: auditErr, policyNumber: req.policyNumber },
      'failed to write endorse audit event',
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

  // Persist the latest envelope so subsequent endorsements layer correctly.
  policy.status = 'ENDORSED';
  policy.endorsedAt = new Date();
  policy.quotationSnapshot = {
    startDate: quotation.startDate,
    endDate: quotation.endDate,
    category: quotation.travelCategory,
    destination: quotation.destination,
  };
  await policy.save();

  const asegoMessage =
    response && typeof response === 'object'
      ? (() => {
          const candidate = Array.isArray(response) ? response[0] : response;
          if (candidate && typeof candidate === 'object' && 'msg' in candidate) {
            const v = (candidate as { msg?: unknown }).msg;
            if (typeof v === 'string') return v;
          }
          return undefined;
        })()
      : undefined;

  return { ok: true, policyNumber: req.policyNumber, asegoMessage };
}

function redactEndorseForAudit(body: ExternalEndorsePolicy): ExternalEndorsePolicy {
  return {
    ...body,
    traveler: {
      ...body.traveler,
      passport: body.traveler.passport ? '[redacted]' : '',
      email: '[redacted]',
      mobileNo: '[redacted]',
      pincode: '[redacted]',
      address: '[redacted]',
    },
  };
}
