// Public registration routes — the multi-step sign-up flow.
//
// Mounted at /api/v1/registrations. Most endpoints are public (the
// applicant doesn't have an account yet); rate-limited by loginLimiter
// so a bot can't spray drafts.
//
// Flow on the client:
//   1. POST /              → create draft, returns registrationId
//   2. PATCH /:id          → save section as user fills it
//   3. POST /:id/otp/...   → send OTP for mobile / email
//   4. POST /:id/verify/...→ confirm OTP / PAN / Aadhar / GST
//   5. POST /:id/submit    → finalize, status: SUBMITTED
// Admin queue routes live in admin-registrations.routes.ts.

import { Router, type Router as RouterT } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '@tripbng/shared';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../utils/validate.js';
import { ok, created } from '../utils/response.js';
import { logger } from '../config/logger.js';
import {
  AgencyRegistration,
  type AgencyRegistrationDoc,
} from '../models/AgencyRegistration.js';
import {
  generateApplicationCode,
  resolveDistributorByReferralCode,
  sendOtp,
  verifyAadhar,
  verifyGst,
  verifyOtp,
  verifyPan,
} from '../services/registration.service.js';

export const registrationsRouter: RouterT = Router();

// ────────── Section schemas ──────────

const CreateRegistrationSchema = z.object({
  agentType: z.enum(['RETAILER', 'CORPORATE', 'TMC', 'OTHER']).default('RETAILER'),
  companyName: z.string().min(2).max(120),
  companyType: z.enum(['PROPRIETOR', 'PARTNER', 'COMPANY_LLP']).default('PROPRIETOR'),
  mobileCountryCode: z.string().default('+91'),
  mobile: z.string().min(7).max(15),
  email: z.string().email().max(120),
});

// PATCH accepts any combination of the registration fields. We use a
// large `.partial()`-style schema rather than per-section endpoints to
// keep the client simple — every field-change pushes the latest state.
const UpdateRegistrationSchema = z
  .object({
    agentType: z.enum(['RETAILER', 'CORPORATE', 'TMC', 'OTHER']),
    companyName: z.string().min(2).max(120),
    companyType: z.enum(['PROPRIETOR', 'PARTNER', 'COMPANY_LLP']),
    mobileCountryCode: z.string(),
    mobile: z.string(),
    whatsappCountryCode: z.string(),
    whatsapp: z.string(),
    whatsappSameAsMobile: z.boolean(),
    email: z.string().email(),
    ownerTitle: z.enum(['MR', 'MRS', 'MS', 'DR']),
    ownerFirstName: z.string().max(80),
    ownerLastName: z.string().max(80),
    ownerDob: z.coerce.date().nullable(),
    panNumber: z.string().max(10),
    panDocUrl: z.string().max(5_500_000),
    addressLine1: z.string().max(200),
    addressLine2: z.string().max(200),
    addressLine3: z.string().max(200),
    country: z.string().max(60),
    state: z.string().max(60),
    city: z.string().max(60),
    pincode: z.string().max(10),
    aadharNumber: z.string().max(15),
    gstNumber: z.string().max(20),
    distributorCode: z.string().max(20),
    salesRepCode: z.string().max(60),
    relationshipManagerCode: z.string().max(60),
    termsAccepted: z.boolean(),
  })
  .partial();

// ────────── Create draft ──────────

registrationsRouter.post(
  '/',
  loginLimiter,
  validate(CreateRegistrationSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof CreateRegistrationSchema>;
      const applicationCode = generateApplicationCode();
      const doc = await AgencyRegistration.create({
        ...body,
        applicationCode,
        status: 'DRAFT',
        submitIp: req.ip ?? null,
        submitUserAgent: req.header('user-agent') ?? null,
      });
      return created(res, serializeRegistration(doc));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Get draft (for resume) ──────────

registrationsRouter.get('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const doc = await AgencyRegistration.findById(id);
    if (!doc) throw new AppError('NOT_FOUND');
    // Public-facing — applicant uses the registrationId from create
    // response to resume; we don't auth this surface yet because the ID
    // is unguessable enough for a draft. Once an applicant has a real
    // account, this should move under requireAuth.
    return ok(res, serializeRegistration(doc));
  } catch (err) {
    next(err);
  }
});

// ────────── Update draft ──────────

registrationsRouter.patch(
  '/:id',
  validate(UpdateRegistrationSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const patch = req.body as z.infer<typeof UpdateRegistrationSchema>;
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      if (doc.status !== 'DRAFT' && doc.status !== 'NEEDS_INFO') {
        throw new AppError('VALIDATION_ERROR', {
          reason: `Cannot edit a registration in status=${doc.status}`,
        });
      }
      // Verification flags reset when the underlying field changes —
      // changing the email means the previous "email verified" is no
      // longer valid; user must re-verify.
      if (patch.email && patch.email.toLowerCase() !== doc.email) {
        doc.emailVerified = false;
        doc.emailVerifiedAt = null;
      }
      if (patch.mobile && patch.mobile !== doc.mobile) {
        doc.mobileVerified = false;
        doc.mobileVerifiedAt = null;
      }
      if (patch.panNumber && patch.panNumber.toUpperCase() !== doc.panNumber) {
        doc.panVerified = false;
        doc.panVerifiedAt = null;
        doc.panNameOnRecord = '';
      }
      if (patch.aadharNumber && patch.aadharNumber !== doc.aadharNumber) {
        doc.aadharVerified = false;
        doc.aadharVerifiedAt = null;
        doc.aadharNameOnRecord = '';
      }
      if (patch.gstNumber && patch.gstNumber.toUpperCase() !== doc.gstNumber) {
        doc.gstVerified = false;
        doc.gstVerifiedAt = null;
        doc.gstLegalName = '';
      }

      Object.assign(doc, patch);
      if (patch.termsAccepted === true && !doc.termsAcceptedAt) {
        doc.termsAcceptedAt = new Date();
      }
      await doc.save();
      return ok(res, serializeRegistration(doc));
    } catch (err) {
      next(err);
    }
  },
);

// ────────── Distributor referral lookup (live as the user types) ──────────

registrationsRouter.get('/distributor/by-code/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').trim();
    if (!code) throw new AppError('VALIDATION_ERROR', { reason: 'Code required' });
    const d = await resolveDistributorByReferralCode(code);
    if (!d) {
      return ok(res, { found: false });
    }
    return ok(res, {
      found: true,
      distributor: {
        id: String(d._id),
        companyName: d.companyName,
        city: d.city,
        state: d.state,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ────────── OTPs (mobile / email / whatsapp) ──────────

const OtpRequestSchema = z.object({
  channel: z.enum(['mobile', 'email', 'whatsapp']),
});

registrationsRouter.post(
  '/:id/otp/send',
  loginLimiter,
  validate(OtpRequestSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const { channel } = req.body as z.infer<typeof OtpRequestSchema>;
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      const to =
        channel === 'email'
          ? doc.email
          : channel === 'mobile'
            ? `${doc.mobileCountryCode}${doc.mobile}`
            : `${doc.whatsappCountryCode}${doc.whatsapp || doc.mobile}`;
      if (!to || (channel !== 'email' && to.length < 7)) {
        throw new AppError('VALIDATION_ERROR', { reason: `${channel} not set on registration` });
      }
      const result = await sendOtp({ registrationId: id, channel, to });
      return ok(res, result);
    } catch (err) {
      next(err);
    }
  },
);

const OtpVerifySchema = z.object({
  channel: z.enum(['mobile', 'email', 'whatsapp']),
  otp: z.string().length(6),
});

registrationsRouter.post(
  '/:id/otp/verify',
  loginLimiter,
  validate(OtpVerifySchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const { channel, otp } = req.body as z.infer<typeof OtpVerifySchema>;
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      const result = await verifyOtp({ registrationId: id, channel, otp });
      if (!result.ok) {
        return ok(res, { ok: false, message: result.reason });
      }
      const now = new Date();
      if (channel === 'mobile') {
        doc.mobileVerified = true;
        doc.mobileVerifiedAt = now;
      } else if (channel === 'email') {
        doc.emailVerified = true;
        doc.emailVerifiedAt = now;
      } else {
        doc.whatsappVerified = true;
        doc.whatsappVerifiedAt = now;
      }
      await doc.save();
      // Return the refreshed registration so the client can update its
      // local form state in-place — no page reload needed for badges
      // to flip from "Verify" → "Verified".
      return ok(res, { ok: true, registration: serializeRegistration(doc) });
    } catch (err) {
      next(err);
    }
  },
);

// ────────── PAN / Aadhar / GST verification ──────────

registrationsRouter.post('/:id/verify/pan', loginLimiter, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const doc = await AgencyRegistration.findById(id);
    if (!doc) throw new AppError('NOT_FOUND');
    if (!doc.panNumber) {
      throw new AppError('VALIDATION_ERROR', { reason: 'PAN number not set' });
    }
    const result = await verifyPan(doc.panNumber);
    if (!result.ok) {
      return ok(res, { ok: false, message: result.message });
    }
    doc.panVerified = true;
    doc.panVerifiedAt = new Date();
    doc.panNameOnRecord = result.nameOnRecord ?? '';
    doc.panVerificationProvider = result.provider ?? null;
    doc.panVerificationRef = result.ref ?? null;
    await doc.save();
    return ok(res, {
      ok: true,
      nameOnRecord: result.nameOnRecord,
      registration: serializeRegistration(doc),
    });
  } catch (err) {
    next(err);
  }
});

const VerifyAadharSchema = z.object({
  otp: z.string().length(6).optional(),
});

registrationsRouter.post(
  '/:id/verify/aadhar',
  loginLimiter,
  validate(VerifyAadharSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id ?? '');
      if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
      const doc = await AgencyRegistration.findById(id);
      if (!doc) throw new AppError('NOT_FOUND');
      if (!doc.aadharNumber) {
        throw new AppError('VALIDATION_ERROR', { reason: 'Aadhar number not set' });
      }
      const { otp } = req.body as z.infer<typeof VerifyAadharSchema>;
      const result = await verifyAadhar({ aadharNumber: doc.aadharNumber, otp });
      if (!result.ok) {
        return ok(res, { ok: false, message: result.message });
      }
      doc.aadharVerified = true;
      doc.aadharVerifiedAt = new Date();
      doc.aadharNameOnRecord = result.nameOnRecord ?? '';
      doc.aadharVerificationProvider = result.provider ?? null;
      doc.aadharVerificationRef = result.ref ?? null;
      await doc.save();
      return ok(res, {
        ok: true,
        nameOnRecord: result.nameOnRecord,
        registration: serializeRegistration(doc),
      });
    } catch (err) {
      next(err);
    }
  },
);

registrationsRouter.post('/:id/verify/gst', loginLimiter, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const doc = await AgencyRegistration.findById(id);
    if (!doc) throw new AppError('NOT_FOUND');
    if (!doc.gstNumber) {
      throw new AppError('VALIDATION_ERROR', { reason: 'GST number not set' });
    }
    const result = await verifyGst(doc.gstNumber);
    if (!result.ok) {
      return ok(res, { ok: false, message: result.message });
    }
    doc.gstVerified = true;
    doc.gstVerifiedAt = new Date();
    doc.gstLegalName = result.legalName ?? '';
    doc.gstVerificationProvider = result.provider ?? null;
    await doc.save();
    return ok(res, {
      ok: true,
      legalName: result.legalName,
      registration: serializeRegistration(doc),
    });
  } catch (err) {
    next(err);
  }
});

// ────────── Submit ──────────

registrationsRouter.post('/:id/submit', loginLimiter, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    if (!Types.ObjectId.isValid(id)) throw new AppError('NOT_FOUND');
    const doc = await AgencyRegistration.findById(id);
    if (!doc) throw new AppError('NOT_FOUND');
    if (doc.status !== 'DRAFT' && doc.status !== 'NEEDS_INFO') {
      throw new AppError('VALIDATION_ERROR', {
        reason: `Already submitted (status=${doc.status})`,
      });
    }
    if (!doc.termsAccepted) {
      throw new AppError('VALIDATION_ERROR', {
        reason: 'You must accept the Terms & Privacy Policy to submit.',
      });
    }
    // Soft submission requirements — we don't block on missing
    // verifications; the admin reviewer sees a checklist and can
    // request NEEDS_INFO. Strict block could be added here later
    // (e.g. require mobile + email + PAN verified).
    doc.status = 'SUBMITTED';
    doc.submittedAt = new Date();
    doc.submitIp = req.ip ?? doc.submitIp;
    doc.submitUserAgent = req.header('user-agent') ?? doc.submitUserAgent;

    // Resolve referral code to a distributor (best-effort — if the code
    // is invalid we just don't attach; the admin reviewer can fix it).
    if (doc.distributorCode) {
      const dist = await resolveDistributorByReferralCode(doc.distributorCode);
      if (dist) {
        doc.distributorId = dist._id as unknown as typeof doc.distributorId;
        doc.distributorVerifiedAt = new Date();
      } else {
        logger.info(
          { regId: String(doc._id), code: doc.distributorCode },
          'registration: distributor referral code did not resolve',
        );
      }
    }

    await doc.save();
    return ok(res, serializeRegistration(doc));
  } catch (err) {
    next(err);
  }
});

// ────────── Serializer ──────────

function serializeRegistration(doc: AgencyRegistrationDoc) {
  return {
    id: String(doc._id),
    applicationCode: doc.applicationCode,
    status: doc.status,
    agentType: doc.agentType,
    companyName: doc.companyName,
    companyType: doc.companyType,
    mobileCountryCode: doc.mobileCountryCode,
    mobile: doc.mobile,
    mobileVerified: doc.mobileVerified,
    whatsappCountryCode: doc.whatsappCountryCode,
    whatsapp: doc.whatsapp,
    whatsappVerified: doc.whatsappVerified,
    whatsappSameAsMobile: doc.whatsappSameAsMobile,
    email: doc.email,
    emailVerified: doc.emailVerified,
    ownerTitle: doc.ownerTitle,
    ownerFirstName: doc.ownerFirstName,
    ownerLastName: doc.ownerLastName,
    ownerDob: doc.ownerDob,
    panNumber: doc.panNumber,
    panVerified: doc.panVerified,
    panNameOnRecord: doc.panNameOnRecord,
    panDocUrl: doc.panDocUrl,
    addressLine1: doc.addressLine1,
    addressLine2: doc.addressLine2,
    addressLine3: doc.addressLine3,
    country: doc.country,
    state: doc.state,
    city: doc.city,
    pincode: doc.pincode,
    aadharNumber: doc.aadharNumber,
    aadharVerified: doc.aadharVerified,
    aadharNameOnRecord: doc.aadharNameOnRecord,
    gstNumber: doc.gstNumber,
    gstVerified: doc.gstVerified,
    gstLegalName: doc.gstLegalName,
    distributorCode: doc.distributorCode,
    distributorId: doc.distributorId ? String(doc.distributorId) : null,
    salesRepCode: doc.salesRepCode,
    relationshipManagerCode: doc.relationshipManagerCode,
    termsAccepted: doc.termsAccepted,
    submittedAt: doc.submittedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
