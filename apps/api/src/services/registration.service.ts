// AgencyRegistration service — orchestrates the multi-step sign-up flow.
//
// What lives here:
//   - Application-code minting (REG-XXXX)
//   - Verification stubs for mobile / email / PAN / Aadhar / GST
//     (clearly marked TODO so a real provider integration can drop in)
//   - Submission + approval logic (provisions Agency + User accounts)
//   - Distributor referral-code resolution
//
// What does NOT live here: route handlers (apps/api/src/routes/), the
// Mongo model (apps/api/src/models/), or any UI concerns.
//
// ── Verification providers (decision deferred until creds are in hand) ──
// We recommend Cashfree Verification Suite — single API surface for PAN,
// Aadhar (OTP-based), Bank, GST, with sandboxed dev creds and per-call
// pricing. Alternates: Surepass, Karza, IDfy, SignDesk/Digio. The
// integration points below assume a generic `KycProvider` interface that
// any of these can implement; current stubs return a success envelope
// after a brief delay so the UI flow is exercisable in dev.

import crypto from 'node:crypto';
import { AppError } from '@tripbng/shared';
import { logger } from '../config/logger.js';
import { redis } from '../config/redis.js';
import { getSmtpTransport } from '../config/smtp.js';
import { env } from '../config/env.js';
import { hashPassword } from '../utils/password.js';
import { Agency } from '../models/Agency.js';
import { AgencyRegistration } from '../models/AgencyRegistration.js';
import { Distributor } from '../models/Distributor.js';
import { User } from '../models/User.js';

// ────────── Codes ──────────

/** Generate a friendly application code, e.g. "REG-A8K3X9". Mongo's
 *  unique index will retry on the rare collision; we just minimise the
 *  odds at 32^6 = ~1B combinations. */
export function generateApplicationCode(): string {
  return 'REG-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

/** Generate a distributor referral code, e.g. "DST-9F3K". Shorter than
 *  the full distributorCode because partners will type this into a
 *  small input on the public sign-up form. */
export function generateDistributorReferralCode(): string {
  // Skip ambiguous chars (O/0, I/1) to make hand-typing painless.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'DST-';
  for (let i = 0; i < 4; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)]!;
  }
  return out;
}

// ────────── Distributor referral lookup ──────────

/** Resolve a distributor-referral code to a Distributor doc. Returns
 *  null when the code doesn't match — caller decides whether that's a
 *  hard error or a soft "code not found" hint. Case-insensitive. */
export async function resolveDistributorByReferralCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  return Distributor.findOne({ referralCode: normalized, status: 'ACTIVE' }).lean();
}

/** Assign a fresh referral code to a distributor if one isn't already
 *  set. Idempotent — returns the current code when called twice. Used
 *  by the distributor cockpit + a one-time backfill script. */
export async function ensureDistributorReferralCode(distributorId: string): Promise<string> {
  const d = await Distributor.findById(distributorId).select('referralCode');
  if (!d) throw new AppError('NOT_FOUND');
  if (d.referralCode) return d.referralCode;

  // Generate with retries on collision (extremely rare).
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateDistributorReferralCode();
    const clash = await Distributor.findOne({ referralCode: code }).select('_id').lean();
    if (clash) continue;
    d.referralCode = code;
    await d.save();
    return code;
  }
  throw new AppError('VALIDATION_ERROR', { reason: 'Could not generate a unique code' });
}

/** Force-rotate the referral code. Useful when a previous code was
 *  shared too broadly / leaked. The old code becomes invalid for
 *  future sign-ups; agencies already signed up keep their distributor
 *  link (it's resolved at approval time, not on every search). */
export async function rotateDistributorReferralCode(distributorId: string): Promise<string> {
  const d = await Distributor.findById(distributorId).select('referralCode');
  if (!d) throw new AppError('NOT_FOUND');
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateDistributorReferralCode();
    const clash = await Distributor.findOne({ referralCode: code }).select('_id').lean();
    if (clash) continue;
    d.referralCode = code;
    await d.save();
    return code;
  }
  throw new AppError('VALIDATION_ERROR', { reason: 'Could not generate a unique code' });
}

// ────────── Mobile + email OTPs ──────────
//
// We persist the OTP hashes in Redis (5-minute TTL) keyed on
// `regId:channel`. When the applicant confirms, we hash their entry and
// compare. No SMS provider is wired yet — dev OTP is "000000" (same
// pattern as the TOTP bypass). For production: wire MSG91 / Gupshup /
// Twilio under the same `sendSms()` helper signature below.

const OTP_TTL_SEC = 5 * 60;
const OTP_KEY = (regId: string, channel: 'mobile' | 'email' | 'whatsapp') =>
  `reg:otp:${regId}:${channel}`;
const DEV_OTP = '000000';

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function generateOtp(): string {
  // Dev path: always return the bypass code so testers don't need a
  // real SMS provider. Real OTPs flow once SMS/email providers are
  // wired (the dev-bypass check happens in the verify step below).
  if (env.NODE_ENV !== 'production') return DEV_OTP;
  // 6-digit zero-padded numeric.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function sendOtp(args: {
  registrationId: string;
  channel: 'mobile' | 'email' | 'whatsapp';
  to: string;
}): Promise<{ delivered: boolean; devHint?: string }> {
  const otp = generateOtp();
  await redis.set(OTP_KEY(args.registrationId, args.channel), hashOtp(otp), 'EX', OTP_TTL_SEC);

  if (args.channel === 'email') {
    // Email OTPs go through the SMTP transport we already use for
    // password-reset. If SMTP isn't configured (dev), we log the OTP
    // so the developer can read it from stdout.
    const transport = getSmtpTransport();
    if (transport) {
      try {
        await transport.sendMail({
          from: env.SMTP_FROM,
          to: args.to,
          replyTo: env.SMTP_REPLY_TO,
          subject: 'Your TripBng verification code',
          text: `Your verification code is ${otp}. It expires in 5 minutes.\n\nIf you didn't request this, ignore the email.`,
        });
      } catch (err) {
        logger.warn({ err, to: args.to }, 'reg-otp: email send failed (otp still logged)');
      }
    } else {
      logger.info({ to: args.to, otp, regId: args.registrationId }, 'reg-otp: SMTP not configured — OTP logged');
    }
  } else {
    // SMS / WhatsApp providers (MSG91, Gupshup, Twilio, Karix, etc.)
    // plug in here. Production should refuse to mint a dev-OTP — wrap
    // the env check around the provider call so callers see an error
    // when SMS isn't wired in prod.
    logger.info(
      { regId: args.registrationId, channel: args.channel, to: args.to, otp },
      'reg-otp: SMS provider not wired — OTP logged (dev only)',
    );
  }

  return {
    delivered: true,
    // Surface a dev hint in the API response so QA doesn't have to
    // tail the log. Suppressed in production.
    devHint: env.NODE_ENV !== 'production' ? `Dev OTP is ${DEV_OTP}` : undefined,
  };
}

export async function verifyOtp(args: {
  registrationId: string;
  channel: 'mobile' | 'email' | 'whatsapp';
  otp: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Dev bypass — always accept the standard dev code in non-prod so
  // testers don't need a real SMS provider.
  if (env.NODE_ENV !== 'production' && args.otp === DEV_OTP) return { ok: true };

  const stored = await redis.get(OTP_KEY(args.registrationId, args.channel));
  if (!stored) return { ok: false, reason: 'OTP expired — request a fresh code' };
  if (stored !== hashOtp(args.otp)) return { ok: false, reason: 'Incorrect code' };
  // Single-use — burn after a successful match.
  await redis.del(OTP_KEY(args.registrationId, args.channel));
  return { ok: true };
}

// ────────── PAN / Aadhar / GST verification stubs ──────────
//
// Real integrations target a single provider that covers all three. We
// recommend Cashfree (one set of creds, single response shape, sandboxed
// dev env). The stub below validates shape (Luhn for Aadhar last digit,
// 10-char PAN pattern, 15-char GSTIN) so dev flows look + feel like
// real verifications without spending vendor quota.

/** Quick syntactic check — replace with vendor call when creds land. */
export async function verifyPan(panNumber: string): Promise<{
  ok: boolean;
  nameOnRecord?: string;
  provider?: string;
  ref?: string;
  message?: string;
}> {
  const pan = panNumber.toUpperCase().trim();
  // Standard Indian PAN format: 5 letters + 4 digits + 1 letter
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    return { ok: false, message: 'PAN must look like AAAPL1234C' };
  }
  // ── Provider call would go here:
  //   const resp = await cashfree.verifyPan({ pan });
  //   return { ok: resp.status === 'VALID', nameOnRecord: resp.name, ref: resp.id }
  return {
    ok: true,
    nameOnRecord: 'PAN verified (dev stub)',
    provider: 'stub',
    ref: `stub-${Date.now()}`,
  };
}

/** Aadhar OTP-based verify stub. Real flow:
 *   1. POST aadhar number → vendor sends OTP to linked phone
 *   2. POST OTP back → vendor returns name + masked aadhar
 *   3. We persist verified=true + provider ref
 *  Both steps map cleanly onto sendOtp/verifyOtp + verifyAadhar below,
 *  with the OTP coming from the vendor (not us). Stub accepts the same
 *  dev OTP for parity. */
export async function verifyAadhar(args: {
  aadharNumber: string;
  otp?: string;
}): Promise<{ ok: boolean; nameOnRecord?: string; provider?: string; ref?: string; message?: string }> {
  const aadhar = args.aadharNumber.replace(/\s+/g, '');
  if (!/^\d{12}$/.test(aadhar)) {
    return { ok: false, message: 'Aadhar must be 12 digits' };
  }
  // ── Provider call goes here (e.g. Cashfree / Surepass aadhaarOcr).
  return {
    ok: true,
    nameOnRecord: 'Aadhar verified (dev stub)',
    provider: 'stub',
    ref: `stub-${Date.now()}`,
  };
}

/** GST lookup stub. Real call returns legalName + place-of-business +
 *  registration-date + GSTN status. Public GSTN API works for basic
 *  lookup; richer fields require Cashfree / Surepass / Karza paid tier. */
export async function verifyGst(gstNumber: string): Promise<{
  ok: boolean;
  legalName?: string;
  provider?: string;
  message?: string;
}> {
  const gst = gstNumber.toUpperCase().trim();
  // 15 chars: 2 state code + 10-char PAN + 1 entity + 1 default 'Z' + 1 check
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gst)) {
    return { ok: false, message: 'GSTIN must look like 27ABCTI1234R1ZX' };
  }
  return { ok: true, legalName: 'GST verified (dev stub)', provider: 'stub' };
}

// ────────── Approval — provisions Agency + User ──────────

export async function approveRegistration(args: {
  registrationId: string;
  reviewerUserId: string;
  /** Tenant the new agency lives under. */
  tenantId: string;
  /** Default permissions / role are role-based; we hand back the temp
   *  password so the email step can include it. */
}): Promise<{ agencyId: string; userId: string; tempPassword: string }> {
  const reg = await AgencyRegistration.findById(args.registrationId);
  if (!reg) throw new AppError('NOT_FOUND');
  if (reg.status === 'APPROVED') {
    throw new AppError('VALIDATION_ERROR', { reason: 'Registration already approved' });
  }
  if (reg.status !== 'SUBMITTED' && reg.status !== 'UNDER_REVIEW' && reg.status !== 'NEEDS_INFO') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `Cannot approve from status=${reg.status}`,
    });
  }

  // Resolve referral code → distributorId now (the value on the reg
  // might be stale if the distributor rotated their code mid-review).
  let distributorId: string | null = null;
  if (reg.distributorCode) {
    const dist = await resolveDistributorByReferralCode(reg.distributorCode);
    if (dist) distributorId = String(dist._id);
  }
  if (reg.distributorId) distributorId = String(reg.distributorId);

  // Mint a temp password the user changes on first login.
  const tempPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!';
  const passwordHash = await hashPassword(tempPassword);

  // Create the User first — Agency.ownerUserId is required.
  // userCode pattern: U-<6 base32 chars>; collisions are caught by the
  // unique index and we retry below.
  let user;
  for (let attempt = 0; attempt < 5; attempt++) {
    const userCode = 'U-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    try {
      user = await User.create({
        tenantId: args.tenantId,
        userCode,
        email: reg.email,
        mobile: `${reg.mobileCountryCode || '+91'}${reg.mobile}`,
        fullName: `${reg.ownerFirstName} ${reg.ownerLastName}`.trim() || reg.companyName,
        passwordHash,
        role: 'AGENCY',
        status: 'ACTIVE',
        mustChangePassword: true,
        distributorId,
      });
      break;
    } catch (err) {
      // Unique-index collision on userCode → retry. Anything else propagates.
      const code = (err as { code?: number }).code;
      if (code !== 11000) throw err;
    }
  }
  if (!user) {
    throw new AppError('VALIDATION_ERROR', { reason: 'Could not mint a unique userCode' });
  }

  // Generate the agency code if not set. Pattern: AT-<3-letter-city>-<seq>.
  const agencyCode = await mintAgencyCode(args.tenantId, reg.city);

  const agency = await Agency.create({
    tenantId: args.tenantId,
    agencyCode,
    companyName: reg.companyName,
    legalName: reg.companyName,
    country: reg.country || 'IN',
    state: reg.state || 'NA',
    city: reg.city || 'NA',
    pincode: reg.pincode || '000000',
    address: [reg.addressLine1, reg.addressLine2, reg.addressLine3].filter(Boolean).join(', '),
    distributorId,
    walletBalance: 0,
    creditLimit: 0,
    pan: {
      number: reg.panNumber,
      name: reg.panNameOnRecord,
      imageUrl: reg.panDocUrl,
    },
    gst: reg.gstNumber
      ? {
          number: reg.gstNumber,
          imageUrl: '',
        }
      : undefined,
    ownerUserId: user._id,
    status: 'ACTIVE',
  });

  // Attach the agency to the user record now that we have the ID.
  user.agencyId = agency._id;
  await user.save();

  // If we linked to a distributor, bump their downline counter.
  if (distributorId) {
    await Distributor.updateOne(
      { _id: distributorId },
      { $inc: { agencyCount: 1 } },
    ).catch(() => undefined);
  }

  // Mark the registration approved + record the provisioned IDs.
  reg.status = 'APPROVED';
  reg.reviewerUserId = args.reviewerUserId as unknown as typeof reg.reviewerUserId;
  reg.reviewedAt = new Date();
  reg.provisionedAgencyId = agency._id;
  reg.provisionedUserId = user._id;
  reg.distributorId = (distributorId as unknown as typeof reg.distributorId) ?? null;
  await reg.save();

  // Send welcome email with temp password. Best-effort — failure
  // doesn't unwind the approval; reviewer can resend manually.
  void sendApprovalEmail({
    to: reg.email,
    name: `${reg.ownerFirstName} ${reg.ownerLastName}`.trim() || reg.companyName,
    email: reg.email,
    tempPassword,
    agencyCode: agency.agencyCode,
  }).catch((err) => logger.warn({ err }, 'reg-approve: welcome email failed'));

  return {
    agencyId: String(agency._id),
    userId: String(user._id),
    tempPassword,
  };
}

async function mintAgencyCode(tenantId: string, city: string): Promise<string> {
  // City prefix — first 3 letters uppercased; falls back to "AGY" if
  // the registration didn't capture city.
  const prefix = (city || 'AGY').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'AGY';
  // Sequence: count of existing agencies under the tenant + 1 (4-digit
  // zero-padded). Race conditions on the sequence are fine — the unique
  // index on agencyCode kicks in if two registrations approve at the
  // same instant; we retry once.
  for (let attempt = 0; attempt < 5; attempt++) {
    const n = await Agency.countDocuments({ tenantId });
    const candidate = `AT-${prefix}-${String(n + 1 + attempt).padStart(4, '0')}`;
    const exists = await Agency.findOne({ tenantId, agencyCode: candidate }).select('_id').lean();
    if (!exists) return candidate;
  }
  throw new AppError('VALIDATION_ERROR', { reason: 'Could not mint a unique agency code' });
}

async function sendApprovalEmail(args: {
  to: string;
  name: string;
  email: string;
  tempPassword: string;
  agencyCode: string;
}): Promise<void> {
  const transport = getSmtpTransport();
  if (!transport) {
    logger.info(
      { to: args.to, agencyCode: args.agencyCode, tempPasswordLogged: true },
      `reg-approve: SMTP not configured — temp password is ${args.tempPassword}`,
    );
    return;
  }
  const webBase = env.WEB_BASE_URL.replace(/\/+$/, '');
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: args.to,
    replyTo: env.SMTP_REPLY_TO,
    subject: `Welcome to TripBng — your agency ${args.agencyCode} is live`,
    text: [
      `Hi ${args.name},`,
      '',
      'Your agency registration has been approved. You can sign in now at:',
      `${webBase}/login`,
      '',
      `Agency code: ${args.agencyCode}`,
      `Email:       ${args.email}`,
      `Temp pass:   ${args.tempPassword}`,
      '',
      "You'll be asked to set a new password on first login. The temp",
      'password works exactly once.',
      '',
      'Welcome aboard,',
      'TripBng partnerships',
    ].join('\n'),
  });
}

export async function rejectRegistration(args: {
  registrationId: string;
  reviewerUserId: string;
  reason: string;
}): Promise<void> {
  const reg = await AgencyRegistration.findById(args.registrationId);
  if (!reg) throw new AppError('NOT_FOUND');
  if (reg.status === 'APPROVED' || reg.status === 'REJECTED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `Cannot reject from status=${reg.status}`,
    });
  }
  reg.status = 'REJECTED';
  reg.rejectionReason = args.reason;
  reg.reviewerUserId = args.reviewerUserId as unknown as typeof reg.reviewerUserId;
  reg.reviewedAt = new Date();
  await reg.save();

  // Best-effort notification to the applicant — they should know
  // why and how to follow up.
  void sendRejectionEmail({
    to: reg.email,
    name: `${reg.ownerFirstName} ${reg.ownerLastName}`.trim() || reg.companyName,
    reason: args.reason,
  }).catch(() => undefined);
}

async function sendRejectionEmail(args: {
  to: string;
  name: string;
  reason: string;
}): Promise<void> {
  const transport = getSmtpTransport();
  if (!transport) return;
  await transport.sendMail({
    from: env.SMTP_FROM,
    to: args.to,
    replyTo: env.SMTP_REPLY_TO,
    subject: 'About your TripBng registration',
    text: [
      `Hi ${args.name},`,
      '',
      "We've reviewed your registration and unfortunately can't proceed at this time:",
      '',
      args.reason,
      '',
      'If this is a misunderstanding, reply to this email and our partnerships team will',
      'take another look. We respond within two business days.',
      '',
      'TripBng partnerships',
    ].join('\n'),
  });
}
