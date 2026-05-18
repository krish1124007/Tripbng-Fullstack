// Hotel Book orchestration.
//
// Runs the most complex pathway in the integration:
//
//   1. Acquire a Redis SETNX lock on the DRAFT to guard against
//      double-clicks (TBO Book is NOT idempotent).
//   2. Re-read the DRAFT, validate state.
//   3. Debit the agency wallet for the selling amount.
//   4. POST /book to TBO with the guest list.
//   5. Branch on the response:
//        confirmed       → status=VOUCHERED, alert+audit
//        held            → status=HELD, schedule voucher job at
//                          (lastCancellationDate − VOUCHER_LEAD_HOURS)
//        pending         → status=PENDING_SUPPLIER, schedule poll
//        verify_price    → REFUND wallet, return new price for re-confirm
//        failed          → REFUND wallet, status=BOOK_FAILED
//   6. Persist supplierRefs + status history.
//
// The wallet flow is "debit-first, refund-on-failure" so a successful Book
// never has to chase down a missing debit. The reverse pattern (book first,
// debit on success) loses out when the wallet runs dry mid-attempt.

import { Types } from 'mongoose';
import { AppError } from '@tripbng/shared';
import { redis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { Agency } from '../../models/Agency.js';
import {
  HotelBooking,
  type HotelBookingDoc,
  type HotelBookingStatus,
} from '../../models/HotelBooking.js';
import { postDebit } from '../wallet/ledger.js';
import { refundHotelBookingDebit } from './refund.js';
import { mapBookResponse, type BookingRefs } from '../../adapters/tbo/mappers/book.mapper.js';
import type {
  TboBookGuest,
  TboBookRequest,
  TboBookResponse,
} from '../../adapters/tbo/types/lifecycle.js';
import { tboCall } from './client.js';
import { getTboPendingBookingPollQueue, getTboVoucherQueue } from '../../queues/index.js';
import { evaluateBookingGate, normalizePolicies } from './policy-guard.service.js';
import { enqueueAlert } from '../alerts/index.js';
import type { HotelApprovalVars, HotelLifecycleVars } from '../alerts/types.js';

const BOOK_LOCK_PREFIX = 'tbo:book:lock:';
const BOOK_LOCK_TTL_SEC = 60;

export interface BookContext {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string;
  distributorId: string | null;
  ipAddress?: string | null;
}

export interface BookGuestInput {
  title: 'Mr' | 'Mrs' | 'Miss' | 'Ms';
  firstName: string;
  middleName?: string | null;
  lastName: string;
  paxType: 'Adult' | 'Child';
  age?: number | null;
  isLeadPassenger?: boolean;
  phone?: string | null;
  email?: string | null;
  pan?: string | null;
  passportNo?: string | null;
  passportIssueDate?: string | null;
  passportExpDate?: string | null;
}

export interface BookInput {
  draftBookingId: string;
  guests: BookGuestInput[];
  /** False → hold only, voucher later. True → voucher in one shot. */
  isVoucherBooking: boolean;
  gst?: {
    gstin: string;
    companyName: string;
    companyAddress: string;
    companyEmail?: string;
    companyPhone?: string;
  };
  /** Optional corporate tagging for finance reports. */
  costCentreCode?: string;
  glCode?: string;
  projectCode?: string;
}

export type BookResult =
  | { kind: 'confirmed'; bookingId: string; supplierRefs: BookingRefs }
  | { kind: 'held'; bookingId: string; supplierRefs: BookingRefs; voucherDeadline: Date | null }
  | { kind: 'pending'; bookingId: string; supplierRefs: BookingRefs; nextPollAt: Date }
  | {
      kind: 'verify_price';
      bookingId: string;
      isPriceChanged: boolean;
      isCancellationPolicyChanged: boolean;
    }
  | { kind: 'failed'; bookingId: string; error: { code: string; message: string } }
  | {
      kind: 'awaiting_approval';
      bookingId: string;
      approverUserId: string | null;
      reasons: string[];
    }
  | { kind: 'blocked'; bookingId: string; reasons: string[] };

/**
 * Confirm a DRAFT booking. The DRAFT must be owned by the calling
 * agency and still in DRAFT state — we don't allow re-running Book on a
 * row that's already past it.
 */
export async function bookHotel(ctx: BookContext, input: BookInput): Promise<BookResult> {
  // Validate guest count vs. room expectations cheaply before locking.
  if (input.guests.length === 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'at least one guest required' });
  }
  if (!input.guests.some((g) => g.isLeadPassenger)) {
    // No explicit lead — pick the first adult.
    const idx = input.guests.findIndex((g) => g.paxType === 'Adult');
    if (idx < 0) throw new AppError('VALIDATION_ERROR', { reason: 'no adult guest provided' });
    input.guests[idx]!.isLeadPassenger = true;
  }

  const lockKey = `${BOOK_LOCK_PREFIX}${input.draftBookingId}`;
  const lockToken = `${process.pid}:${Date.now()}`;
  const acquired = await redis
    .set(lockKey, lockToken, 'EX', BOOK_LOCK_TTL_SEC, 'NX')
    .catch(() => null);
  if (!acquired) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'a Book request for this draft is already in flight',
    });
  }

  try {
    return await runBook(ctx, input);
  } finally {
    // Best-effort lock release; expiry takes over on crash.
    const current = await redis.get(lockKey).catch(() => null);
    if (current === lockToken) await redis.del(lockKey).catch(() => undefined);
  }
}

async function runBook(ctx: BookContext, input: BookInput): Promise<BookResult> {
  const draft = await loadDraft(ctx, input.draftBookingId);
  const bookingCode = draft.supplierRefs?.bookingCode;
  if (!bookingCode) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'draft booking has no supplier BookingCode (PreBook never ran)',
    });
  }

  // Capture the corporate tagging on the draft before any branching — both
  // approval and direct-book paths benefit from these being persisted.
  if (input.costCentreCode !== undefined) draft.costCentreCode = input.costCentreCode;
  if (input.glCode !== undefined) draft.glCode = input.glCode;
  if (input.projectCode !== undefined) draft.projectCode = input.projectCode;

  // ── Corporate policy gate ──
  // Pull agency policies and decide whether to proceed, route to approval,
  // or hard-block. Defence-in-depth: search-time filter should have caught
  // hard violations, but a user could land here via an offer chosen before
  // a policy change.
  const sellingPaise = draft.pricing?.totalSellingPaise ?? 0;
  if (sellingPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'draft has no positive selling price' });
  }
  const gateOutcome = await evaluateGate(draft, sellingPaise);
  if (gateOutcome.gate === 'block') {
    await transitionStatus(
      draft,
      'BOOK_FAILED',
      ctx.userId,
      `Policy block: ${gateOutcome.reasons.join(', ')}`,
    );
    return { kind: 'blocked', bookingId: String(draft._id), reasons: gateOutcome.reasons };
  }
  if (gateOutcome.gate === 'require_approval') {
    return await persistAwaitingApproval(draft, input, ctx, gateOutcome.reasons, gateOutcome.approverUserId);
  }
  // gate === 'allow' → delegate to the shared executor.
  return await executeTboBook(draft, input, ctx, sellingPaise);
}

/**
 * Wallet debit + TBO Book + outcome branching. Shared between the direct-
 * book path (post-gate-allow) and the approval path (post-manager-approve).
 *
 * Pre-conditions:
 *   - draft.supplierRefs.bookingCode is set (PreBook ran)
 *   - sellingPaise > 0
 *   - draft.guests / draft.gst are populated either by the caller (approval
 *     path; data was persisted at AWAITING_APPROVAL time) or below (direct
 *     path; buildBookBody mutates the doc as a side effect).
 */
async function executeTboBook(
  draft: HotelBookingDoc,
  input: BookInput,
  ctx: BookContext,
  sellingPaise: number,
): Promise<BookResult> {
  const bookingCode = draft.supplierRefs?.bookingCode ?? '';
  if (!bookingCode) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'cannot execute Book — draft is missing supplier BookingCode',
    });
  }

  // ── Wallet debit ──
  // We use the existing ledger primitive; postDebit throws INSUFFICIENT_WALLET
  // when the agency can't cover the bill. That bubbles up as a 422 to the UI.
  const debit = await postDebit({
    tenantId: ctx.tenantId,
    walletKind: 'AGENCY',
    walletOwnerId: ctx.agencyId,
    type: 'BOOKING_DEBIT',
    amountPaise: sellingPaise,
    performedBy: ctx.userId,
    description: `Hotel booking ${draft.hotel?.name ?? bookingCode}`,
    ipAddress: ctx.ipAddress ?? null,
    metadata: { hotelBookingId: String(draft._id), bookingCode },
  });

  // Interim state APPROVED = wallet debited, in flight to TBO. Distinct from
  // AWAITING_APPROVAL (= policy-gate hold awaiting manager). Same word, two
  // meanings — the statusHistory note disambiguates.
  await transitionStatus(draft, 'APPROVED', ctx.userId, 'wallet debited; calling TBO Book');
  draft.walletDebitTxnId = debit._id;

  // ── Build TBO request body ──
  const body = buildBookBody(input, bookingCode, draft);

  let res: TboBookResponse;
  try {
    res = await tboCall<TboBookResponse>({
      method: 'Book',
      host: 'hotelBe',
      path: '/book/',
      body: body as unknown as Record<string, unknown>,
      ctx: { bookingId: String(draft._id), bookingCode },
    });
  } catch (err) {
    // Transport failure — refund and surface.
    await refundWallet(draft, ctx, sellingPaise, 'TBO Book transport error');
    await transitionStatus(draft, 'BOOK_FAILED', ctx.userId, err instanceof Error ? err.message : 'TBO failure');
    void dispatchFailedAlert(
      draft,
      ctx,
      err instanceof Error ? err.message.slice(0, 200) : 'TBO transport failure',
    );
    throw err;
  }

  draft.rawRequests = { ...(draft.rawRequests ?? {}), book: redactGuests(body) };
  draft.rawResponses = { ...(draft.rawResponses ?? {}), book: res };

  const outcome = mapBookResponse(res);

  switch (outcome.kind) {
    case 'confirmed': {
      draft.supplierRefs = mergeRefs(draft.supplierRefs, outcome.refs);
      draft.bookedAt = new Date();
      draft.confirmedAt = new Date();
      draft.vouchredAt = new Date();
      await transitionStatus(draft, 'VOUCHERED', ctx.userId, 'TBO Book → Confirmed');
      logger.info({ bookingId: String(draft._id), confirmationNo: outcome.refs.confirmationNo }, 'tbo.book: confirmed');
      void dispatchConfirmedAlert(draft, ctx);
      return { kind: 'confirmed', bookingId: String(draft._id), supplierRefs: outcome.refs };
    }

    case 'held': {
      draft.supplierRefs = mergeRefs(draft.supplierRefs, outcome.refs);
      draft.bookedAt = new Date();
      await transitionStatus(draft, 'HELD', ctx.userId, 'TBO Book → Held; voucher pending');
      // Schedule the voucher job at (lastCancellationDate − lead). When TBO
      // didn't return a cancellation date, fall back to 24h after now.
      const lcd = draft.lastCancellationDate ? new Date(draft.lastCancellationDate) : null;
      const voucherAt = lcd
        ? new Date(lcd.getTime() - env.TBO_VOUCHER_LEAD_HOURS * 60 * 60 * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const delay = Math.max(0, voucherAt.getTime() - Date.now());
      await getTboVoucherQueue().add(
        'voucher',
        { bookingId: String(draft._id) },
        { delay, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
      logger.info(
        { bookingId: String(draft._id), voucherAt: voucherAt.toISOString() },
        'tbo.book: held, voucher scheduled',
      );
      return { kind: 'held', bookingId: String(draft._id), supplierRefs: outcome.refs, voucherDeadline: lcd };
    }

    case 'pending': {
      draft.supplierRefs = mergeRefs(draft.supplierRefs, outcome.refs);
      draft.bookedAt = new Date();
      draft.pendingPoll = { attempts: 0, lastPolledAt: null };
      await transitionStatus(draft, 'PENDING_SUPPLIER', ctx.userId, 'TBO Book → Pending');
      const initialDelay = env.TBO_PENDING_POLL_INITIAL_DELAY_MS;
      await getTboPendingBookingPollQueue().add(
        'poll',
        { bookingId: String(draft._id) },
        { delay: initialDelay },
      );
      const nextPollAt = new Date(Date.now() + initialDelay);
      logger.info(
        { bookingId: String(draft._id), nextPollAt: nextPollAt.toISOString() },
        'tbo.book: pending; poll scheduled',
      );
      return { kind: 'pending', bookingId: String(draft._id), supplierRefs: outcome.refs, nextPollAt };
    }

    case 'verify_price': {
      // Price/policy drifted after PreBook — refund and ask the user.
      await refundWallet(draft, ctx, sellingPaise, 'TBO Book → VerifyPrice; refunded for re-confirm');
      draft.isPriceChanged = outcome.isPriceChanged;
      draft.isCancellationPolicyChanged = outcome.isCancellationPolicyChanged;
      await transitionStatus(draft, 'DRAFT', ctx.userId, 'TBO returned VerifyPrice; awaiting re-confirm');
      return {
        kind: 'verify_price',
        bookingId: String(draft._id),
        isPriceChanged: outcome.isPriceChanged,
        isCancellationPolicyChanged: outcome.isCancellationPolicyChanged,
      };
    }

    case 'failed': {
      await refundWallet(draft, ctx, sellingPaise, `TBO Book failed: ${outcome.error.message}`);
      await transitionStatus(draft, 'BOOK_FAILED', ctx.userId, outcome.error.message);
      logger.warn({ bookingId: String(draft._id), error: outcome.error }, 'tbo.book: failed');
      void dispatchFailedAlert(draft, ctx, outcome.error.message);
      return { kind: 'failed', bookingId: String(draft._id), error: outcome.error };
    }
  }
}

/** Helper for the CONFIRMED branch — emits HOTEL_BOOKING_CONFIRMED to the
 *  booker + booking_contact. Best-effort. */
export async function dispatchConfirmedAlert(
  draft: HotelBookingDoc,
  ctx: BookContext,
): Promise<void> {
  try {
    await enqueueAlert(
      { event: 'HOTEL_BOOKING_CONFIRMED', vars: buildLifecycleVars(draft) },
      [
        { kind: 'user', id: String(draft.bookedByUserId ?? ctx.userId) },
        { kind: 'booking_contact', bookingId: String(draft._id) },
      ],
      {
        tenantId: ctx.tenantId,
        correlationKey: `hotel-booking:${String(draft._id)}`,
      },
    );
  } catch (err) {
    logger.warn({ err, bookingId: String(draft._id) }, 'hotel-booking-confirmed alert failed');
  }
}

/** Helper for the FAILED branch — emits HOTEL_BOOKING_FAILED to the
 *  booker. Best-effort. */
export async function dispatchFailedAlert(
  draft: HotelBookingDoc,
  ctx: BookContext,
  failureReason: string,
): Promise<void> {
  try {
    await enqueueAlert(
      {
        event: 'HOTEL_BOOKING_FAILED',
        vars: { ...buildLifecycleVars(draft), failureReason },
      },
      [
        { kind: 'user', id: String(draft.bookedByUserId ?? ctx.userId) },
        ...(draft.agencyId ? [{ kind: 'agency', id: String(draft.agencyId) } as const] : []),
      ],
      {
        tenantId: ctx.tenantId,
        correlationKey: `hotel-booking:${String(draft._id)}`,
      },
    );
  } catch (err) {
    logger.warn({ err, bookingId: String(draft._id) }, 'hotel-booking-failed alert failed');
  }
}

// ────────── helpers ──────────

async function loadDraft(ctx: BookContext, draftId: string): Promise<HotelBookingDoc> {
  if (!Types.ObjectId.isValid(draftId)) throw new AppError('NOT_FOUND');
  const filter: Record<string, unknown> = {
    _id: draftId,
    tenantId: ctx.tenantId,
  };
  if (ctx.role === 'AGENCY' || ctx.role === 'SUB_AGENT') {
    filter.agencyId = ctx.agencyId;
  }
  const doc = await HotelBooking.findOne(filter);
  if (!doc) throw new AppError('NOT_FOUND');
  if (doc.status !== 'DRAFT') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${doc.status}, not DRAFT (already booked?)`,
    });
  }
  // Confirm an agency was attached to the draft (or attach it now).
  if (!doc.agencyId) {
    doc.agencyId = new Types.ObjectId(ctx.agencyId);
  }
  return doc;
}

function buildBookBody(
  input: BookInput,
  bookingCode: string,
  draft: HotelBookingDoc,
): TboBookRequest {
  const passengers = input.guests.map<TboBookGuest>((g) => ({
    Title: g.title,
    FirstName: g.firstName,
    MiddleName: g.middleName ?? undefined,
    LastName: g.lastName,
    PaxType: g.paxType === 'Adult' ? 1 : 2,
    Age: g.age ?? undefined,
    LeadGuest: g.isLeadPassenger === true,
    PhoneNumber: g.phone ?? undefined,
    Email: g.email ?? undefined,
    PAN: g.pan ?? undefined,
    PassportNo: g.passportNo ?? undefined,
    PassportIssueDate: g.passportIssueDate ?? undefined,
    PassportExpDate: g.passportExpDate ?? undefined,
  }));

  // Persist guest snapshot on the draft for reporting + audit. Use splice
  // to mutate the DocumentArray in place (Mongoose's DocumentArray rejects
  // raw plain-array assignment; splice respects its tracking).
  draft.guests.splice(
    0,
    draft.guests.length,
    ...input.guests.map((g) => ({
      title: g.title,
      firstName: g.firstName,
      middleName: g.middleName ?? null,
      lastName: g.lastName,
      paxType: g.paxType,
      age: g.age ?? null,
      isLeadPassenger: g.isLeadPassenger === true,
      phone: g.phone ?? null,
      email: g.email ?? null,
      // PAN/passport stay encrypted (the model has select:false on these fields).
      pan: g.pan ?? null,
      passportNo: g.passportNo ?? null,
      passportIssueDate: g.passportIssueDate ? new Date(g.passportIssueDate) : null,
      passportExpDate: g.passportExpDate ? new Date(g.passportExpDate) : null,
    })),
  );
  if (input.gst) {
    draft.gst = {
      gstin: input.gst.gstin,
      companyName: input.gst.companyName,
      companyAddress: input.gst.companyAddress,
    };
  }

  return {
    ClientId: '',
    TokenId: '',
    EndUserIp: '',
    BookingCode: bookingCode,
    HotelRoomsDetails: [{ HotelPassenger: passengers }],
    IsVoucherBooking: input.isVoucherBooking,
    GSTNumber: input.gst?.gstin,
    GSTCompanyName: input.gst?.companyName,
    GSTCompanyAddress: input.gst?.companyAddress,
    GSTCompanyEmail: input.gst?.companyEmail,
    GSTCompanyContactNumber: input.gst?.companyPhone,
  };
}

function mergeRefs(
  existing: HotelBookingDoc['supplierRefs'],
  fresh: BookingRefs,
): HotelBookingDoc['supplierRefs'] {
  return {
    ...(existing ?? {}),
    bookingId: fresh.bookingId ?? existing?.bookingId ?? null,
    bookingRefNo: fresh.bookingRefNo ?? existing?.bookingRefNo ?? null,
    confirmationNo: fresh.confirmationNo ?? existing?.confirmationNo ?? null,
    invoiceNumber: fresh.invoiceNumber ?? existing?.invoiceNumber ?? null,
    bookingCode: existing?.bookingCode ?? null,
    traceId: existing?.traceId ?? null,
  };
}

async function transitionStatus(
  doc: HotelBookingDoc,
  status: HotelBookingStatus,
  byUserId: string,
  note: string,
): Promise<void> {
  doc.status = status;
  doc.statusHistory.push({
    status,
    at: new Date(),
    by: new Types.ObjectId(byUserId),
    note,
  });
  await doc.save();
}

async function refundWallet(
  doc: HotelBookingDoc,
  ctx: BookContext,
  amountPaise: number,
  description: string,
): Promise<void> {
  // Delegates to the shared refund helper. Keeps this private wrapper as
  // a thin shim so the existing call sites don't need to change shape.
  await refundHotelBookingDebit({
    doc,
    amountPaise,
    description,
    performedByUserId: ctx.userId,
    ipAddress: ctx.ipAddress ?? null,
  });
}

/**
 * Run the corporate-policy gate for this draft. Loads the agency's
 * hotelPolicies subdoc and decides allow / require_approval / block.
 */
async function evaluateGate(
  draft: HotelBookingDoc,
  sellingPaise: number,
): Promise<{ gate: 'allow' | 'require_approval' | 'block'; reasons: string[]; approverUserId: string | null }> {
  if (!draft.agencyId) return { gate: 'allow', reasons: [], approverUserId: null };
  const agency = await Agency.findById(draft.agencyId)
    .select('hotelPolicies ownerUserId')
    .lean();
  if (!agency) return { gate: 'allow', reasons: [], approverUserId: null };
  const policies = normalizePolicies(agency.hotelPolicies ?? null);

  // Heuristic: chain match on hotel name (TBO doesn't reliably expose a
  // separate brand field). Same heuristic the search-time filter uses.
  const hotelChain = (() => {
    const lc = (draft.hotel?.name ?? '').toLowerCase();
    return policies.blockedChains.find((c: string) => lc.includes(c.toLowerCase())) ?? null;
  })();

  const result = evaluateBookingGate(
    {
      totalSellingPaise: sellingPaise,
      isRefundable: draft.isRefundable === true,
      hotelName: draft.hotel?.name ?? '',
      hotelChain,
      starRating: draft.hotel?.starRating ?? null,
      nights: draft.nights ?? 1,
    },
    policies,
  );

  // Resolve the approver: explicit pref → agency owner.
  const approverUserId =
    policies.defaultApproverUserId ??
    (agency.ownerUserId ? String(agency.ownerUserId) : null);

  return { gate: result.gate, reasons: result.reasons, approverUserId };
}

/**
 * Persist the booking in AWAITING_APPROVAL state, capturing the guest data
 * so the approval service can resume the actual TBO Book later.
 */
async function persistAwaitingApproval(
  draft: HotelBookingDoc,
  input: BookInput,
  ctx: BookContext,
  reasons: string[],
  approverUserId: string | null,
): Promise<BookResult> {
  // Persist guest snapshot — same machinery as the direct-book path.
  draft.guests.splice(
    0,
    draft.guests.length,
    ...input.guests.map((g) => ({
      title: g.title,
      firstName: g.firstName,
      middleName: g.middleName ?? null,
      lastName: g.lastName,
      paxType: g.paxType,
      age: g.age ?? null,
      isLeadPassenger: g.isLeadPassenger === true,
      phone: g.phone ?? null,
      email: g.email ?? null,
      pan: g.pan ?? null,
      passportNo: g.passportNo ?? null,
      passportIssueDate: g.passportIssueDate ? new Date(g.passportIssueDate) : null,
      passportExpDate: g.passportExpDate ? new Date(g.passportExpDate) : null,
    })),
  );
  if (input.gst) {
    draft.gst = {
      gstin: input.gst.gstin,
      companyName: input.gst.companyName,
      companyAddress: input.gst.companyAddress,
    };
  }
  draft.pendingApproval = {
    isVoucherBooking: input.isVoucherBooking,
    requestedAt: new Date(),
    requestedByUserId: new Types.ObjectId(ctx.userId),
    approverUserId: approverUserId ? new Types.ObjectId(approverUserId) : null,
    reasons,
    decisionNote: null,
    decidedAt: null,
    decidedByUserId: null,
    decision: null,
  };
  await transitionStatus(
    draft,
    'AWAITING_APPROVAL',
    ctx.userId,
    `Awaiting approval: ${reasons.join(', ')}`,
  );
  logger.info(
    { bookingId: String(draft._id), reasons, approverUserId },
    'tbo.book: awaiting approval',
  );

  // Notify the approver. Email + in-app via the alert dispatcher; failure
  // here MUST NOT block the request (logged + swallowed inside enqueueAlert).
  if (approverUserId) {
    void enqueueAlert(
      {
        event: 'HOTEL_BOOKING_AWAITS_APPROVAL',
        vars: buildApprovalVars(draft, reasons),
      },
      [{ kind: 'user', id: approverUserId }],
      {
        tenantId: ctx.tenantId,
        correlationKey: `hotel-approval:${String(draft._id)}`,
      },
    );
  }

  return {
    kind: 'awaiting_approval',
    bookingId: String(draft._id),
    approverUserId,
    reasons,
  };
}

/** Build a deep-link to the booker-facing booking-detail page. */
function buildBookingDetailUrl(bookingId: string): string {
  return `${env.WEB_BASE_URL.replace(/\/$/, '')}/bookings/${bookingId}`;
}

/** Build a deep-link to the approver's review-and-decide page. */
function buildApprovalDetailUrl(bookingId: string): string {
  return `${env.WEB_BASE_URL.replace(/\/$/, '')}/approvals/${bookingId}`;
}

/** Build lifecycle vars from a HotelBooking doc. Shared between
 *  CONFIRMED / FAILED / CANCELLED templates. The HotelLifecycleVars base
 *  shape covers the common fields; callers spread in event-specific extras
 *  (failureReason, refundPaise, …). */
export function buildLifecycleVars(draft: HotelBookingDoc): HotelLifecycleVars {
  return {
    bookingId: String(draft._id),
    bookingCode: draft.bookingCode ?? null,
    hotelName: draft.hotel?.name ?? draft.supplierRefs?.bookingCode ?? 'Hotel booking',
    city: draft.hotel?.cityId ?? null,
    checkIn: draft.checkIn ? draft.checkIn.toISOString().slice(0, 10) : '—',
    checkOut: draft.checkOut ? draft.checkOut.toISOString().slice(0, 10) : '—',
    nights: draft.nights ?? 0,
    totalSellingPaise: draft.pricing?.totalSellingPaise ?? 0,
    confirmationNo: draft.supplierRefs?.confirmationNo ?? null,
    invoiceNumber: draft.supplierRefs?.invoiceNumber ?? null,
    detailUrl: buildBookingDetailUrl(String(draft._id)),
  };
}

/** Build the alert payload from a HotelBooking doc. Shared between
 *  AWAITS_APPROVAL / APPROVED / REJECTED templates — they all read the
 *  same fields off the booking row.
 *
 *  AWAITS_APPROVAL routes to the approver's review page; APPROVED / REJECTED
 *  route to the booker's detail page. The caller doesn't need to know
 *  which event will use the result — the templates pick the right URL
 *  via their own action-url logic, but for the email CTA we route to the
 *  approval page when the booking is still in pendingApproval state. */
export function buildApprovalVars(
  draft: HotelBookingDoc,
  reasons: string[],
  decidedBy?: string | null,
  decisionNote?: string | null,
): HotelApprovalVars {
  // Booker-facing URL for APPROVED/REJECTED (decided !== null);
  // approver-facing URL for AWAITS_APPROVAL (decided === null).
  const isPostDecision = !!decidedBy || !!decisionNote;
  const detailUrl = isPostDecision
    ? buildBookingDetailUrl(String(draft._id))
    : buildApprovalDetailUrl(String(draft._id));
  return {
    bookingId: String(draft._id),
    hotelName: draft.hotel?.name ?? draft.supplierRefs?.bookingCode ?? 'Hotel booking',
    city: draft.hotel?.cityId ?? null,
    checkIn: draft.checkIn ? draft.checkIn.toISOString().slice(0, 10) : '—',
    checkOut: draft.checkOut ? draft.checkOut.toISOString().slice(0, 10) : '—',
    nights: draft.nights ?? 0,
    totalSellingPaise: draft.pricing?.totalSellingPaise ?? 0,
    reasons,
    detailUrl,
    decidedBy: decidedBy ?? null,
    decisionNote: decisionNote ?? null,
  };
}

/**
 * Continue an APPROVED booking through the full Book pathway. Called by the
 * approval service after a manager approves. Re-uses the same execution
 * path as the direct-book route — the only difference is that loadDraft is
 * skipped and the function operates on an already-loaded doc.
 *
 * Pre-conditions:
 *   - doc.status is APPROVED (caller has just transitioned it)
 *   - doc.guests, doc.pendingApproval.isVoucherBooking, doc.gst are populated
 *
 * Returns the same BookResult shape as the original /book call.
 */
export async function executeApprovedBooking(
  doc: HotelBookingDoc,
): Promise<BookResult> {
  if (doc.status !== 'APPROVED') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `executeApprovedBooking requires APPROVED status, got ${doc.status}`,
    });
  }
  if (!doc.agencyId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'approved booking has no agencyId' });
  }
  if (!doc.bookedByUserId) {
    throw new AppError('VALIDATION_ERROR', { reason: 'approved booking has no bookedByUserId' });
  }
  const sellingPaise = doc.pricing?.totalSellingPaise ?? 0;
  if (sellingPaise <= 0) {
    throw new AppError('VALIDATION_ERROR', { reason: 'approved booking has no selling price' });
  }

  // Reconstruct context from the doc — wallet ops attribute to the original
  // booker, not the approving manager.
  const ctx: BookContext = {
    tenantId: String(doc.tenantId),
    userId: String(doc.bookedByUserId),
    role: 'AGENCY',
    agencyId: String(doc.agencyId),
    distributorId: doc.distributorId ? String(doc.distributorId) : null,
    ipAddress: null,
  };

  // Reconstruct the original BookInput from the persisted doc — this is
  // what executeTboBook needs to rebuild the TBO request body. Guest data
  // was saved on the doc at AWAITING_APPROVAL persistence time.
  const guests = (doc.guests ?? []).map((g) => ({
    title: g.title as 'Mr' | 'Mrs' | 'Miss' | 'Ms',
    firstName: g.firstName ?? '',
    middleName: g.middleName ?? null,
    lastName: g.lastName ?? '',
    paxType: (g.paxType as 'Adult' | 'Child') ?? 'Adult',
    age: g.age ?? null,
    isLeadPassenger: g.isLeadPassenger === true,
    phone: g.phone ?? null,
    email: g.email ?? null,
    pan: g.pan ?? null,
    passportNo: g.passportNo ?? null,
    passportIssueDate: g.passportIssueDate ? new Date(g.passportIssueDate).toISOString() : null,
    passportExpDate: g.passportExpDate ? new Date(g.passportExpDate).toISOString() : null,
  }));
  const input: BookInput = {
    draftBookingId: String(doc._id),
    guests,
    isVoucherBooking: doc.pendingApproval?.isVoucherBooking ?? false,
    gst:
      doc.gst?.gstin && doc.gst?.companyName && doc.gst?.companyAddress
        ? {
            gstin: doc.gst.gstin,
            companyName: doc.gst.companyName,
            companyAddress: doc.gst.companyAddress,
          }
        : undefined,
    costCentreCode: doc.costCentreCode ?? undefined,
    glCode: doc.glCode ?? undefined,
    projectCode: doc.projectCode ?? undefined,
  };

  // Skip the gate (already approved) — go straight to executeTboBook.
  return await executeTboBook(doc, input, ctx, sellingPaise);
}

/** Strip PAN / passport from the guest list before persisting to
 *  rawRequests.book — the booking row is queryable by support and we
 *  don't want regulated PII in there. */
function redactGuests(body: TboBookRequest): unknown {
  const cloned = JSON.parse(JSON.stringify(body)) as TboBookRequest;
  for (const room of cloned.HotelRoomsDetails ?? []) {
    for (const p of room.HotelPassenger ?? []) {
      if (p.PAN) p.PAN = '[REDACTED]';
      if (p.PassportNo) p.PassportNo = '[REDACTED]';
    }
  }
  return cloned;
}
