import {
  AppError,
  CODE_PREFIX,
  type ConfirmBookingRequest,
  type HoldRequest,
  type SearchResult,
} from '@tripbng/shared';
import { Booking, type BookingDoc } from '../models/Booking.js';
import { Inventory } from '../models/Inventory.js';
import { Agency } from '../models/Agency.js';
import { FareRule } from '../models/FareRule.js';
import { recordAudit } from './audit.service.js';
import { postCredit, postDebit } from './wallet/ledger.js';
import { logger } from '../config/logger.js';
import { nextCode } from '../utils/codes.js';
import { adapterForCode, decodeFareToken, getCachedSearch } from './search.service.js';
import { Actor, EVENTS, track } from './analytics.service.js';
import { enqueueAlert } from './alerts/index.js';
import { env, isProd } from '../config/env.js';
import { createHmac, randomBytes } from 'node:crypto';
import { SupplierAdapterError } from '../adapters/types.js';
import { enqueueFlightCancelPoll } from '../queues/index.js';
import { matchManualIssuance } from './booking/manual-issuance-matcher.service.js';

export interface BookingActor {
  tenantId: string;
  userId: string;
  role: string;
  agencyId: string;
  distributorId: string | null;
  ipAddress?: string | null;
}

// holdBooking — locks seats with the supplier, freezes pricing on the booking row, sets a
// 30-minute expiry. Wallet isn't touched yet — confirm does that.
export async function holdBooking(actor: BookingActor, input: HoldRequest): Promise<BookingDoc> {
  const search = await getCachedSearch(input.searchId);
  if (!search) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'searchId expired or not found — re-search and try again',
    });
  }
  // `result` is reassigned when the supplier-fallback path picks a
  // different fare to actually hold against — see the attempt loop
  // below. The booking row stores the fare that finally held, not the
  // one the agent originally selected.
  // eslint-disable-next-line prefer-const
  let result = search.results.find((r) => r.fareToken === input.fareToken);
  if (!result) throw new AppError('VALIDATION_ERROR', { reason: 'fareToken not in search' });

  const passengerCount = countPax(input.passengers);
  const totalSeats = passengerCount.adults + passengerCount.children;
  if (totalSeats < 1) throw new AppError('VALIDATION_ERROR', { reason: 'no seat-occupying pax' });

  const agency = await Agency.findById(actor.agencyId).lean();
  if (!agency) throw new AppError('AGENCY_NOT_FOUND');

  let decoded = decodeFareToken(input.fareToken);
  let adapter = adapterForCode(decoded.supplierCode, actor.tenantId);

  const heldAt = new Date();
  const expiresAt = new Date(heldAt.getTime() + 30 * 60 * 1000);

  // ── Production supplier fallback ──
  //
  // When the primary supplier rejects the hold (sandbox quirk, expired
  // session, IP whitelist, supplier-side outage), we look at the
  // search response for any OTHER fare on the same physical flight
  // (same airline + flight numbers + departure date) and retry with
  // the cheapest alternative. Capped at 3 attempts so a flaky
  // supplier doesn't keep us in a retry loop while the agent waits.
  //
  // Dev mode keeps its synthetic-success fallback after this chain
  // exhausts, so local development still works without real creds.

  const flightSig = result.segments
    .map((s) => `${s.airline.code}${s.flightNumber}@${new Date(s.departure).toISOString().slice(0, 10)}`)
    .join('|');
  const fallbackFares = (search.results ?? [])
    .filter(
      (r) =>
        r.fareToken !== input.fareToken &&
        r.segments
          .map(
            (s) =>
              `${s.airline.code}${s.flightNumber}@${new Date(s.departure).toISOString().slice(0, 10)}`,
          )
          .join('|') === flightSig,
    )
    .sort((a, b) => a.totalGrossPaise - b.totalGrossPaise)
    .slice(0, 2); // try at most 2 fallbacks → 3 attempts total

  // SSR audit — log the picks before forwarding so we have a record
  // of what was sold. Supplier adapters that consume ssrSelections
  // (TBO, Kafila) inline them into their hold/ticket payloads; others
  // (eTrav, MOCK, Series, AirIQ) silently ignore them and the agent
  // sees them on the invoice line items only. This audit row lets
  // finance reconcile when an agent claims they sold +20kg baggage.
  if (input.ssrSelections) {
    const ssr = input.ssrSelections;
    logger.info(
      {
        supplier: decoded.supplierCode,
        adapterSupportsSsr: ['TBO', 'KAFILA'].includes(decoded.supplierCode),
        mealsCount: ssr.meals?.length ?? 0,
        baggageCount: ssr.baggage?.length ?? 0,
        seatsCount: ssr.seats?.length ?? 0,
        mealsTotalPaise: (ssr.meals ?? []).reduce((s, m) => s + (m.pricePaise ?? 0), 0),
        baggageTotalPaise: (ssr.baggage ?? []).reduce((s, b) => s + (b.pricePaise ?? 0), 0),
        seatsTotalPaise: (ssr.seats ?? []).reduce((s, x) => s + (x.pricePaise ?? 0), 0),
      },
      'booking.hold ssr-forwarded',
    );
  }

  // Build the per-attempt hold-request body once — pax + contact +
  // SSR are identical across fallback attempts; only the
  // supplierFareToken changes.
  const buildHoldRequest = (supplierFareToken: string) => ({
    supplierFareToken,
    passengerCount,
    passengers: input.passengers.map((p) => ({
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      gender: p.gender,
      nationality: p.nationality,
      passport: p.passport
        ? {
            number: p.passport.number,
            issuingCountry: p.passport.issuingCountry,
            expiry: p.passport.expiry,
          }
        : undefined,
    })),
    contact: {
      email: input.contact.email,
      mobile: input.contact.mobile,
      countryCode: input.contact.countryCode,
    },
    // Pass SSR selections straight through. Adapters that don't support
    // SSR (Series, Mock, eTrav for now) ignore the field; TBO surfaces
    // the picks in its Book (GDS) or Ticket (LCC) request body.
    ssrSelections: input.ssrSelections,
  });

  // Each attempt is (decoded fareToken, original/fallback result).
  // Try them in order — same-flight fallbacks are pre-sorted cheapest
  // first by the filter above.
  const attempts: Array<{ tokenDecoded: typeof decoded; result: typeof result }> = [
    { tokenDecoded: decoded, result },
    ...fallbackFares.map((alt) => ({
      tokenDecoded: decodeFareToken(alt.fareToken),
      result: alt,
    })),
  ];

  let holdResp: Awaited<ReturnType<typeof adapter.hold>> | null = null;
  let lastErr: unknown = null;

  for (const attempt of attempts) {
    const attemptAdapter = adapterForCode(attempt.tokenDecoded.supplierCode, actor.tenantId);
    try {
      holdResp = await attemptAdapter.hold(
        buildHoldRequest(attempt.tokenDecoded.supplierFareToken),
      );
      // Success — rebind the active result + decoded supplier so the
      // downstream booking row points at the fare that actually held.
      result = attempt.result;
      decoded = attempt.tokenDecoded;
      adapter = attemptAdapter;
      if (attempt !== attempts[0]) {
        logger.warn(
          {
            primarySupplier: attempts[0]!.tokenDecoded.supplierCode,
            fallbackSupplier: attempt.tokenDecoded.supplierCode,
            primaryPaise: attempts[0]!.result.totalGrossPaise,
            fallbackPaise: attempt.result.totalGrossPaise,
            priceDeltaPaise:
              attempt.result.totalGrossPaise - attempts[0]!.result.totalGrossPaise,
          },
          'flight booking held via supplier fallback — primary supplier rejected the hold',
        );
      }
      break;
    } catch (err) {
      lastErr = err;
      logger.warn(
        {
          supplier: attempt.tokenDecoded.supplierCode,
          attemptIndex: attempts.indexOf(attempt),
          error: err instanceof Error ? err.message : String(err),
        },
        'flight hold attempt failed — trying next fallback',
      );
    }
  }

  // All real-supplier attempts exhausted.
  if (!holdResp) {
    if (isProd) {
      // Surface the last error so the agent / support can see what
      // every supplier said. AppError preserves the message chain.
      throw lastErr ?? new AppError('SUPPLIER_UNAVAILABLE', { reason: 'all suppliers rejected the hold' });
    }
    logger.warn(
      {
        attempts: attempts.length,
        lastError: lastErr instanceof Error ? lastErr.message : String(lastErr),
      },
      'All supplier hold attempts failed in dev — synthesising a fake hold so the booking flow stays usable. ' +
        'Set NODE_ENV=production to disable this fallback.',
    );
    const fakeRef = `SBX-${randomBytes(4).toString('hex').toUpperCase()}`;
    holdResp = {
      supplierBookingRef: fakeRef,
      pnr: `DEV${Math.floor(Math.random() * 99999)
        .toString()
        .padStart(5, '0')}`,
      expiresAt,
    };
  }

  const bookingCode = await nextCode(CODE_PREFIX.BOOKING);
  const segment0 = result.segments[0];
  if (!segment0) throw new AppError('VALIDATION_ERROR', { reason: 'no segment in fare' });

  const sector = result.segments.map((s) => `${s.origin.code}-${s.destination.code}`).join(' / ');

  // The pricing snapshot we store is per-pax × pax-count, summed.
  const totals = sumPricing(result, passengerCount);

  // Snapshot fareName / fareNameDescription onto the booking — per the ticket
  // spec (§2.2 + §6) we never read these live from Inventory at render time.
  // Falls back to the platform default 'SkySaver' for non-inventory bookings
  // (LCC / FSC live-API results) so legacy bookings still print cleanly.
  let fareNameSnapshot = 'SkySaver';
  let fareNameDescriptionSnapshot = '';
  if (result.inventoryId) {
    const inv = await Inventory.findById(result.inventoryId)
      .select('fareName fareNameDescription')
      .lean();
    if (inv?.fareName) fareNameSnapshot = inv.fareName;
    if (inv?.fareNameDescription) fareNameDescriptionSnapshot = inv.fareNameDescription;
  }

  const booking = await Booking.create({
    tenantId: actor.tenantId,
    bookingCode,
    channel: 'ONLINE',
    flowSubType: result.source === 'SERIES' ? 'SERIES' : result.source === 'LCC' ? 'LCC' : 'FSC',
    productType: 'FLIGHT',

    fareName: fareNameSnapshot,
    fareNameDescription: fareNameDescriptionSnapshot,

    inventoryId: result.inventoryId ?? null,
    supplierCode: decoded.supplierCode,
    supplierBookingRef: holdResp.supplierBookingRef,
    pnr: holdResp.pnr ?? null,
    airlinePnr: holdResp.pnr ?? null,
    ticketNumbers: [],

    agencyId: actor.agencyId,
    agencyCode: agency.agencyCode,
    agencyName: agency.companyName,
    distributorId: actor.distributorId ?? null,
    bookedByUserId: actor.userId,

    sector,
    travelDate: new Date(segment0.departure),
    tripType: search.request.tripType,
    travelClass: result.travelClass,
    segments: result.segments.map((s) => ({
      flightNumber: s.flightNumber,
      airline: s.airline,
      origin: s.origin,
      destination: s.destination,
      departure: new Date(s.departure),
      arrival: new Date(s.arrival),
      duration: s.duration,
      stopOver: s.stopOver,
    })),

    passengers: input.passengers.map((p) => ({
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth ?? null,
      gender: p.gender ?? null,
      nationality: p.nationality ?? null,
      passport: p.passport
        ? {
            number: p.passport.number,
            expiry: p.passport.expiry,
            issuingCountry: p.passport.issuingCountry,
          }
        : undefined,
      fareCategory: p.fareCategory,
    })),

    contact: input.contact,
    gst: input.gst ?? undefined,

    pricing: {
      ...totals,
      currency: 'INR',
    },
    pricingTrace: [],

    seatsConsumed: totalSeats,

    paymentStatus: 'PENDING',
    status: 'HOLD',
    initiatedAt: heldAt,
    heldAt,
    expiresAt,

    internalNotes: input.internalNotes ?? null,
  });

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.hold',
    resource: 'booking',
    resourceId: String(booking._id),
    after: {
      bookingCode: booking.bookingCode,
      sector,
      seats: totalSeats,
      gross: totals.grossAmountPaise,
      supplier: decoded.supplierCode,
    },
    ip: actor.ipAddress ?? null,
  });

  track({
    event: EVENTS.BOOKING_HELD,
    distinctId: Actor.agency(actor.agencyId),
    properties: {
      booking_code: booking.bookingCode,
      booking_id: String(booking._id),
      sector,
      seats: totalSeats,
      pax_adults: passengerCount.adults,
      pax_children: passengerCount.children,
      pax_infants: passengerCount.infants,
      gross_amount_paise: totals.grossAmountPaise,
      agency_payable_paise: totals.agencyPayablePaise,
      supplier: decoded.supplierCode,
      tenant_id: actor.tenantId,
    },
  });

  // Hold-expiry warning — schedule a delayed alert 5 minutes before the hold
  // expires. The dispatcher checks booking.status at fire time (via the
  // template render path) so a booking that's already been confirmed or
  // cancelled before the warning fires gets dropped silently.
  // We compute the delay once here; the dispatcher is responsible for the
  // is-still-HOLD recheck (TODO: add that recheck once the queue is in active
  // use — for now we always fire and let the recipient ignore stale warnings).
  const HOLD_WARNING_LEAD_MS = 5 * 60 * 1000;
  const warningDelayMs = expiresAt.getTime() - Date.now() - HOLD_WARNING_LEAD_MS;
  if (warningDelayMs > 0) {
    void enqueueAlert(
      {
        event: 'HOLD_EXPIRY_WARNING',
        vars: {
          bookingCode: booking.bookingCode,
          sector,
          expiresAt: expiresAt.toISOString(),
          minutesRemaining: 5,
        },
      },
      [
        { kind: 'user', id: actor.userId },
        { kind: 'booking_contact', bookingId: String(booking._id) },
      ],
      {
        tenantId: actor.tenantId,
        correlationKey: `hold-warn:${booking.bookingCode}`,
        delayMs: warningDelayMs,
      },
    );
  }

  return booking;
}

// confirmBooking — validates the hold is still alive, debits the wallet, writes the
// supplier's ticket call (synthesized for series), and transitions to TICKETED.
export async function confirmBooking(
  actor: BookingActor,
  input: ConfirmBookingRequest,
): Promise<BookingDoc> {
  // Atomic HOLD → TICKETING_IN_PROGRESS claim. The previous flow read the
  // booking, checked status, then saved — two concurrent /confirm calls
  // could both pass the `status === 'HOLD'` check before either save
  // committed, causing a double wallet debit + double supplier ticket call.
  // `findOneAndUpdate` with the status in the filter makes the transition
  // atomic at the Mongo layer: only one caller flips HOLD→TICKETING_IN_PROGRESS;
  // the loser sees `null` and we surface the same error a status-mismatch
  // read would have produced.
  const claimed = await Booking.findOneAndUpdate(
    {
      _id: input.bookingId,
      tenantId: actor.tenantId,
      agencyId: actor.agencyId,
      status: 'HOLD',
    },
    { $set: { status: 'TICKETING_IN_PROGRESS' } },
    { new: true },
  );

  if (!claimed) {
    // Distinguish "not ours / not found" from "already in flight" so the
    // client sees the right message. One extra lookup; only on the loser
    // path, so the happy path stays one round-trip.
    const existing = await Booking.findOne({
      _id: input.bookingId,
      tenantId: actor.tenantId,
      agencyId: actor.agencyId,
    })
      .select({ status: 1, expiresAt: 1 })
      .lean();
    if (!existing) throw new AppError('NOT_FOUND');
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${existing.status}, not HOLD`,
    });
  }
  const booking = claimed;

  if (booking.expiresAt && booking.expiresAt < new Date()) {
    booking.status = 'EXPIRED';
    await booking.save();
    // Recover seats from inventory if applicable.
    if (booking.inventoryId && booking.seatsConsumed > 0) {
      await Inventory.updateOne(
        { _id: booking.inventoryId },
        { $inc: { seatsRemaining: booking.seatsConsumed } },
      );
    }
    throw new AppError('HOLD_EXPIRED');
  }

  let walletTxnId;
  try {
    const debit = await postDebit({
      tenantId: actor.tenantId,
      walletKind: 'AGENCY',
      walletOwnerId: actor.agencyId,
      type: 'BOOKING_DEBIT',
      amountPaise: booking.pricing!.agencyPayablePaise,
      performedBy: actor.userId,
      bookingId: String(booking._id),
      description: `Booking ${booking.bookingCode} ${booking.sector}`,
      ipAddress: actor.ipAddress ?? null,
    });
    walletTxnId = debit._id;
  } catch (err) {
    booking.status = 'HOLD';
    await booking.save();
    throw err;
  }

  // ── Phase 5 — Manual issuance gate ──────────────────────────────────────
  //
  // Check whether any matching Map Source has `manualIssuance.pendingBooking`
  // enabled AND the booking matches the criteria block. If so, we SKIP the
  // supplier API entirely. The wallet was debited above; the booking lands
  // in PENDING_MANUAL so ops can issue a PNR + supplier reference manually
  // via the admin endpoint.
  //
  // Failure mode: if the matcher throws (DB hiccup, malformed config) the
  // booking falls through to the normal supplier ticket path. The matcher
  // is purely additive — it can only narrow the set of bookings that go to
  // the supplier, never widen it.
  {
    const agency = await Agency.findById(actor.agencyId)
      .select({ agencyGroupIds: 1 })
      .lean();
    try {
      const match = await matchManualIssuance(booking, {
        tenantId: actor.tenantId,
        agencyId: actor.agencyId,
        agencyGroupIds: (agency?.agencyGroupIds ?? []).map(String),
      });
      if (match.matched) {
        booking.status = 'PENDING_MANUAL';
        booking.paymentMode = input.paymentMode;
        booking.paymentStatus = 'PAID';
        booking.walletDebitTxnId = walletTxnId as unknown as typeof booking.walletDebitTxnId;
        // Preserve audit trail for ops.
        booking.internalNotes = booking.internalNotes
          ? `${booking.internalNotes}\nPending manual: ${match.reason ?? 'matched Map Source'}`
          : `Pending manual: ${match.reason ?? 'matched Map Source'}`;
        await booking.save();
        await recordAudit({
          tenantId: actor.tenantId,
          actorId: actor.userId,
          actorRole: actor.role,
          action: 'booking.routed_to_pending_manual',
          resource: 'booking',
          resourceId: String(booking._id),
          after: {
            mapSourceId: match.mapSourceId,
            reason: match.reason,
            skippedFields: match.skippedFields,
          },
          ip: actor.ipAddress ?? null,
        });
        track({
          event: EVENTS.BOOKING_CONFIRMED,
          distinctId: Actor.agency(actor.agencyId),
          properties: {
            booking_code: booking.bookingCode,
            booking_id: String(booking._id),
            sector: booking.sector,
            supplier: booking.supplierCode,
            payment_mode: input.paymentMode,
            amount_paise: booking.pricing?.agencyPayablePaise ?? 0,
            pending_manual: true,
            map_source_id: match.mapSourceId,
            tenant_id: actor.tenantId,
          },
        });
        return booking;
      }
    } catch (matchErr) {
      // Don't poison a real booking with a config bug — fall through to the
      // standard supplier ticket path. Loud log so ops notices.
      logger.error(
        { err: matchErr, bookingId: String(booking._id) },
        'manual-issuance matcher threw — falling back to supplier ticket call',
      );
    }
  }

  // Issue the ticket via the adapter (series → instant, mock → instant).
  const adapter = adapterForCode(booking.supplierCode, actor.tenantId);
  try {
    let ticketResp;
    try {
      ticketResp = await adapter.ticket({
        supplierBookingRef: booking.supplierBookingRef ?? '',
      });
    } catch (ticketErr) {
      // Dev-mode fallback — synthesise a successful ticketing response
      // when the supplier rejects. Mirrors the hold-fallback pattern
      // so the booking + payment flow stays usable end-to-end without
      // live supplier credentials. Production always re-throws.
      if (isProd) throw ticketErr;
      logger.warn(
        {
          supplier: booking.supplierCode,
          bookingCode: booking.bookingCode,
          error: ticketErr instanceof Error ? ticketErr.message : String(ticketErr),
        },
        'Supplier ticket failed in dev — synthesising a fake ticket response. ' +
          'Set NODE_ENV=production to disable this fallback.',
      );
      ticketResp = {
        pnr: booking.pnr ?? `DEV${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`,
        ticketNumbers: [
          `${booking.supplierCode.slice(0, 2)}${Math.floor(Math.random() * 9999999999)
            .toString()
            .padStart(10, '0')}`,
        ],
      };
    }
    booking.pnr = ticketResp.pnr ?? booking.pnr;
    booking.ticketNumbers = ticketResp.ticketNumbers ?? [];
    booking.status = 'TICKETED';
    booking.paymentMode = input.paymentMode;
    booking.paymentStatus = 'PAID';
    booking.ticketedAt = new Date();
    booking.walletDebitTxnId = walletTxnId as unknown as typeof booking.walletDebitTxnId;
    await booking.save();
  } catch (err) {
    // Reverse the debit — credit it back so the agency isn't left out of pocket.
    logger.fatal(
      { err, bookingId: String(booking._id), walletTxnId: String(walletTxnId) },
      'ticket failed after wallet debit — refunding agency',
    );
    try {
      const refund = await postCredit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: actor.agencyId,
        type: 'REFUND_CREDIT',
        amountPaise: booking.pricing!.agencyPayablePaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        relatedTxnId: String(walletTxnId),
        description: `Booking ${booking.bookingCode} ticket failed — auto-refund`,
      });
      booking.walletRefundTxnId = refund._id;
    } catch (refundErr) {
      logger.fatal({ refundErr }, 'auto-refund FAILED — manual reconciliation needed');
    }
    booking.status = 'FAILED';
    booking.paymentStatus = 'FAILED';
    await booking.save();
    track({
      event: EVENTS.BOOKING_FAILED,
      distinctId: Actor.agency(actor.agencyId),
      properties: {
        booking_code: booking.bookingCode,
        booking_id: String(booking._id),
        supplier: booking.supplierCode,
        amount_paise: booking.pricing!.agencyPayablePaise,
        reason: err instanceof Error ? err.message : 'unknown',
        tenant_id: actor.tenantId,
      },
    });
    void enqueueAlert(
      {
        event: 'BOOKING_FAILED',
        vars: {
          bookingCode: booking.bookingCode,
          pnr: null,
          sector: booking.sector,
          travelDate: booking.travelDate ? booking.travelDate.toISOString().slice(0, 10) : '—',
          paxCount: totalPaxCount(booking),
          amountPaise: booking.pricing!.agencyPayablePaise,
          ticketUrl: null,
          failureReason: err instanceof Error ? err.message.slice(0, 200) : 'supplier failure',
        },
      },
      [
        { kind: 'user', id: actor.userId },
        { kind: 'agency', id: actor.agencyId },
      ],
      {
        tenantId: actor.tenantId,
        correlationKey: `booking:${booking.bookingCode}`,
      },
    );
    throw err;
  }

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.ticket',
    resource: 'booking',
    resourceId: String(booking._id),
    after: {
      bookingCode: booking.bookingCode,
      pnr: booking.pnr,
      paid: booking.pricing!.agencyPayablePaise,
    },
    ip: actor.ipAddress ?? null,
  });

  track({
    event: EVENTS.BOOKING_CONFIRMED,
    distinctId: Actor.agency(actor.agencyId),
    properties: {
      booking_code: booking.bookingCode,
      booking_id: String(booking._id),
      pnr: booking.pnr ?? null,
      ticket_count: booking.ticketNumbers?.length ?? 0,
      sector: booking.sector,
      supplier: booking.supplierCode,
      payment_mode: input.paymentMode,
      gross_amount_paise: booking.pricing!.grossAmountPaise,
      agency_payable_paise: booking.pricing!.agencyPayablePaise,
      tenant_id: actor.tenantId,
    },
  });

  // Multi-channel alert — fan-out to email + WhatsApp + in-app for both the
  // bookedByUser AND the booking contact (which may be a customer email/mobile
  // distinct from the user account). The dispatcher dedupes on resolved
  // contact details so duplicate sends don't happen if both refs resolve to
  // the same email/mobile in practice.
  void enqueueAlert(
    {
      event: 'BOOKING_CONFIRMED',
      vars: {
        bookingCode: booking.bookingCode,
        pnr: booking.pnr ?? null,
        sector: booking.sector,
        travelDate: booking.travelDate ? booking.travelDate.toISOString().slice(0, 10) : '—',
        paxCount: totalPaxCount(booking),
        amountPaise: booking.pricing!.agencyPayablePaise,
        ticketUrl: signedTicketUrl(String(booking._id)),
      },
    },
    [
      { kind: 'user', id: actor.userId },
      { kind: 'booking_contact', bookingId: String(booking._id) },
    ],
    {
      tenantId: actor.tenantId,
      correlationKey: `booking:${booking.bookingCode}`,
    },
  );

  // Auto-generate the GST invoice when the booking has GST details
  // attached. Best-effort — a failure here MUST NOT roll back the
  // ticketed booking. Service skips silently for non-GST bookings.
  // Lazy import to avoid circular dependency (invoice.service →
  // booking.service via Booking model registration order).
  void (async () => {
    try {
      const { generateInvoiceForFlightBooking } = await import('./flight/invoice.service.js');
      await generateInvoiceForFlightBooking(booking._id);
    } catch (err) {
      logger.error(
        { err, bookingId: String(booking._id), bookingCode: booking.bookingCode },
        'flight invoice auto-generation failed (booking is still TICKETED)',
      );
    }
  })();

  return booking;
}

/**
 * issueManually — Phase 5 admin op. Finalizes a PENDING_MANUAL booking by
 * stamping the PNR + ticket numbers (+ optional supplier reference) ops
 * obtained out-of-band, then transitions the booking to TICKETED. The
 * wallet was already debited at confirmBooking time, so no money moves
 * here — this is a metadata-only write.
 *
 * Auth: caller is the admin actor (not the agency that owns the booking).
 * The route layer enforces `booking:issue-manual`; this function trusts
 * that gate and only checks tenant scoping.
 */
export async function issueManually(
  actor: BookingActor,
  bookingId: string,
  input: {
    pnr: string;
    ticketNumbers: string[];
    supplierBookingRef?: string | null;
    note?: string | null;
  },
): Promise<BookingDoc> {
  const booking = await Booking.findOne({
    _id: bookingId,
    tenantId: actor.tenantId,
  });
  if (!booking) throw new AppError('NOT_FOUND');
  if (booking.status !== 'PENDING_MANUAL') {
    throw new AppError('VALIDATION_ERROR', {
      reason: `booking is ${booking.status}; only PENDING_MANUAL can be issued manually`,
    });
  }

  const before = { status: booking.status, pnr: booking.pnr, supplierBookingRef: booking.supplierBookingRef };

  booking.pnr = input.pnr;
  booking.ticketNumbers = input.ticketNumbers;
  if (input.supplierBookingRef) booking.supplierBookingRef = input.supplierBookingRef;
  booking.status = 'TICKETED';
  booking.ticketedAt = new Date();
  if (input.note) {
    booking.internalNotes = booking.internalNotes
      ? `${booking.internalNotes}\nManual issue: ${input.note}`
      : `Manual issue: ${input.note}`;
  }
  await booking.save();

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.issue_manually',
    resource: 'booking',
    resourceId: String(booking._id),
    before,
    after: {
      status: booking.status,
      pnr: booking.pnr,
      ticketNumbers: booking.ticketNumbers,
      supplierBookingRef: booking.supplierBookingRef,
    },
    ip: actor.ipAddress ?? null,
  });

  track({
    event: EVENTS.BOOKING_CONFIRMED,
    distinctId: Actor.agency(String(booking.agencyId)),
    properties: {
      booking_code: booking.bookingCode,
      booking_id: String(booking._id),
      sector: booking.sector,
      supplier: booking.supplierCode,
      manual_issue: true,
      tenant_id: actor.tenantId,
    },
  });

  return booking;
}

// cancelBooking — applies the fare-rule cancellation fee (if any), credits the refund to
// the wallet, releases inventory seats, and marks the booking CANCELLED → REFUNDED.
export async function cancelBooking(
  actor: BookingActor,
  bookingId: string,
  reason: string,
): Promise<BookingDoc> {
  const booking = await Booking.findOne({
    _id: bookingId,
    tenantId: actor.tenantId,
    agencyId: actor.agencyId,
  });
  if (!booking) throw new AppError('NOT_FOUND');

  if (!['HOLD', 'TICKETED', 'CONFIRMED', 'PENDING_MANUAL'].includes(booking.status)) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `cannot cancel a ${booking.status} booking`,
    });
  }

  const isHold = booking.status === 'HOLD';
  const wasPaid = booking.status !== 'HOLD' && booking.paymentStatus === 'PAID';

  // ── Void window ──
  //
  // Airlines typically allow zero-fee cancellation in the first N
  // hours after ticketing — the GDS / NDC supplier records the void
  // and the seats go straight back to inventory. We mirror that:
  // bookings cancelled inside the `TRIPBNG_FLIGHT_VOID_WINDOW_HOURS`
  // window skip the fare-rule fee entirely.
  const voidWindowMs = env.TRIPBNG_FLIGHT_VOID_WINDOW_HOURS * 60 * 60 * 1000;
  const isVoidEligible =
    wasPaid &&
    voidWindowMs > 0 &&
    booking.ticketedAt &&
    Date.now() - booking.ticketedAt.getTime() < voidWindowMs;

  let cancellationFeePaise = 0;
  if (wasPaid && !isVoidEligible && booking.inventoryId) {
    cancellationFeePaise = await computeCancellationFee(booking);
  }
  const refundPaise = Math.max(
    0,
    (booking.pricing?.agencyPayablePaise ?? 0) - cancellationFeePaise,
  );

  if (isVoidEligible) {
    logger.info(
      {
        bookingCode: booking.bookingCode,
        ticketedAt: booking.ticketedAt?.toISOString(),
        ageHours: (Date.now() - (booking.ticketedAt?.getTime() ?? 0)) / (60 * 60 * 1000),
      },
      'flight booking voided within free-void window — skipping fare-rule fee',
    );
  }

  booking.status = 'CANCEL_REQUESTED';
  await booking.save();

  // Release inventory seats back.
  if (booking.inventoryId && booking.seatsConsumed > 0) {
    await Inventory.updateOne(
      { _id: booking.inventoryId },
      { $inc: { seatsRemaining: booking.seatsConsumed } },
    );
  }

  // Dispatch the supplier-side cancel — best-effort, doesn't block the
  // local refund. SeriesAdapter is a no-op (inventory is the source of
  // truth); MockAdapter pretends success. TBO/eTrav fire real API calls
  // and surface a cancellationReference we round-trip on the booking row.
  //
  // Failure handling: log fatal, mark the booking with a flag for ops
  // review, but proceed with local refund. The customer doesn't suffer
  // a delay because supplier reconciliation is async anyway. Idempotent:
  // if supplierCancellationRef is already set, skip — the cancel-poll
  // worker will handle reconciliation.
  if (booking.supplierBookingRef && !booking.supplierCancellationRef) {
    try {
      const adapter = adapterForCode(booking.supplierCode, actor.tenantId);
      // SeriesAdapter has no supplier behind it — calling cancel() on it
      // returns an ok shape but contributes nothing. Skip cleanly.
      if (adapter.capabilities.includes('CANCEL')) {
        const supplierResp = await adapter.cancel({
          supplierBookingRef: booking.supplierBookingRef,
          reason,
        });
        booking.supplierCancellationRef =
          supplierResp.cancellationReference ?? null;
        // Distinguish async settlement (TBO returns a ChangeRequestId — the
        // worker reconciles to PROCESSED/REJECTED) from sync cancel (Series
        // returns ok with no ref — supplier side is already done).
        booking.supplierCancellationStatus = supplierResp.cancellationReference
          ? 'PENDING'
          : 'PROCESSED';
        logger.info(
          {
            bookingId: String(booking._id),
            supplier: booking.supplierCode,
            cancellationRef: supplierResp.cancellationReference,
            sync: !supplierResp.cancellationReference,
          },
          'supplier cancel dispatched',
        );
        // Schedule the first reconciliation poll only for async adapters
        // (TBO today). Silently skipped for sync adapters since their state
        // is already terminal.
        if (booking.supplierCode === 'TBO' && supplierResp.cancellationReference) {
          await enqueueFlightCancelPoll({
            bookingId: String(booking._id),
            attempt: 0,
          });
        }
      }
    } catch (err) {
      // Don't throw — local refund must still happen. Tag the booking
      // with FAILED status so ops can manually retry the supplier cancel.
      booking.supplierCancellationStatus = 'FAILED';
      const reasonText =
        err instanceof SupplierAdapterError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      booking.internalNotes = booking.internalNotes
        ? `${booking.internalNotes}\nSupplier cancel failed: ${reasonText}`
        : `Supplier cancel failed: ${reasonText}`;
      logger.fatal(
        {
          err,
          bookingId: String(booking._id),
          supplier: booking.supplierCode,
        },
        'supplier cancel dispatch failed — booking flagged for ops review',
      );
    }
  }

  // Refund wallet (only if there was a debit to refund).
  if (wasPaid && refundPaise > 0) {
    try {
      const refund = await postCredit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: actor.agencyId,
        type: 'REFUND_CREDIT',
        amountPaise: refundPaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        relatedTxnId: booking.walletDebitTxnId ? String(booking.walletDebitTxnId) : undefined,
        description: `Refund for ${booking.bookingCode} (cancellation${cancellationFeePaise > 0 ? ` − fee ${cancellationFeePaise / 100} INR` : ''})`,
      });
      booking.walletRefundTxnId = refund._id;
      booking.paymentStatus = 'REFUNDED';
      booking.refundedAt = new Date();
    } catch (err) {
      logger.fatal({ err }, 'refund failed during cancellation — manual reconciliation needed');
    }
    if (cancellationFeePaise > 0) {
      // Record the fee as a separate ledger entry — keeps the audit trail clean.
      await postDebit({
        tenantId: actor.tenantId,
        walletKind: 'AGENCY',
        walletOwnerId: actor.agencyId,
        type: 'CANCELLATION_FEE',
        amountPaise: cancellationFeePaise,
        performedBy: actor.userId,
        bookingId: String(booking._id),
        description: `Cancellation fee for ${booking.bookingCode}`,
        // Admins shouldn't see this go negative; in practice the refund came in first so
        // there's headroom — but keep the safety on.
      });
    }
  }

  booking.status = 'CANCELLED';
  booking.cancelledAt = new Date();
  booking.internalNotes = booking.internalNotes
    ? `${booking.internalNotes}\nCancelled: ${reason}`
    : `Cancelled: ${reason}`;
  await booking.save();

  // Void the GST invoice (if one was issued). Lazy-import to avoid
  // circular dep with invoice.service. Best-effort — finance can
  // reconcile manually if this fails.
  void (async () => {
    try {
      const { cancelFlightInvoice } = await import('./flight/invoice.service.js');
      await cancelFlightInvoice(booking._id);
    } catch (err) {
      logger.error(
        { err, bookingId: String(booking._id) },
        'flight invoice cancel failed (booking is still CANCELLED)',
      );
    }
  })();

  await recordAudit({
    tenantId: actor.tenantId,
    actorId: actor.userId,
    actorRole: actor.role,
    action: 'booking.cancel',
    resource: 'booking',
    resourceId: String(booking._id),
    after: {
      reason,
      isHold,
      cancellationFeePaise,
      refundPaise,
    },
    ip: actor.ipAddress ?? null,
  });

  track({
    event: EVENTS.BOOKING_CANCELLED,
    distinctId: Actor.agency(actor.agencyId),
    properties: {
      booking_code: booking.bookingCode,
      booking_id: String(booking._id),
      sector: booking.sector,
      supplier: booking.supplierCode,
      was_hold: isHold,
      cancellation_fee_paise: cancellationFeePaise,
      refund_paise: refundPaise,
      reason,
      tenant_id: actor.tenantId,
    },
  });

  // Cancel alert — only fires when there's actual money movement (refund or
  // cancellation fee). Pure HOLD cancellations get the in-app trail through
  // analytics but no email/WA spam.
  if (refundPaise > 0 || cancellationFeePaise > 0) {
    void enqueueAlert(
      {
        event: 'BOOKING_CANCELLED',
        vars: {
          bookingCode: booking.bookingCode,
          pnr: booking.pnr ?? null,
          sector: booking.sector,
          travelDate: booking.travelDate ? booking.travelDate.toISOString().slice(0, 10) : '—',
          paxCount: totalPaxCount(booking),
          amountPaise: booking.pricing?.agencyPayablePaise ?? 0,
          ticketUrl: null,
          refundPaise,
          cancellationFeePaise,
        },
      },
      [
        { kind: 'user', id: actor.userId },
        { kind: 'booking_contact', bookingId: String(booking._id) },
      ],
      {
        tenantId: actor.tenantId,
        correlationKey: `booking:${booking.bookingCode}`,
      },
    );
  }

  return booking;
}

async function computeCancellationFee(booking: BookingDoc): Promise<number> {
  // Look up the fare rule attached to the inventory; pick the band whose hours-before-window
  // covers "now". If no fare rule is set, default fee is zero (full refund).
  if (!booking.inventoryId) return 0;
  const inv = await Inventory.findById(booking.inventoryId).select('fareRuleId').lean();
  if (!inv?.fareRuleId) return 0;
  const rule = await FareRule.findById(inv.fareRuleId).lean();
  if (!rule) return 0;

  const departure = booking.travelDate;
  if (!departure) return 0;
  const hoursBefore = Math.max(
    0,
    Math.floor((departure.getTime() - Date.now()) / (60 * 60 * 1000)),
  );

  const matching = (rule.cancellationBands ?? []).find(
    (b) =>
      hoursBefore >= b.hoursBeforeFrom &&
      (b.hoursBeforeTo == null || hoursBefore < b.hoursBeforeTo),
  );
  if (!matching) return 0;

  const baseAmount = booking.pricing?.agencyPayablePaise ?? 0;
  if (matching.feeType === 'NON_REFUNDABLE') return baseAmount;
  if (matching.feeType === 'FLAT') return Math.min(baseAmount, matching.feeValue);
  // PERCENT — basis-points × 100. 2500 = 25%.
  return Math.min(baseAmount, Math.round((baseAmount * matching.feeValue) / 10000));
}

function countPax(passengers: HoldRequest['passengers']): {
  adults: number;
  children: number;
  infants: number;
} {
  return passengers.reduce(
    (s, p) => {
      if (p.type === 'ADULT') s.adults += 1;
      else if (p.type === 'CHILD') s.children += 1;
      else s.infants += 1;
      return s;
    },
    { adults: 0, children: 0, infants: 0 },
  );
}

/** Pax count from a saved booking — for alert vars where we don't have the
 *  HoldRequest available (post-confirm). */
function totalPaxCount(booking: BookingDoc): number {
  return (booking.passengers ?? []).length;
}

/** Build a tamper-proof URL the alert recipient can click to download the
 *  e-ticket without authenticating. Same scheme used by whatsapp.service.ts —
 *  HMAC over `${bookingId}.${exp}` with JWT_ACCESS_SECRET. */
function signedTicketUrl(bookingId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const sig = createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update(`${bookingId}.${exp}`)
    .digest('hex');
  const base = env.API_BASE_URL.replace(/\/$/, '');
  return `${base}/api/v1/bookings/${bookingId}/ticket?sig=${sig}&exp=${exp}`;
}

function sumPricing(
  result: SearchResult,
  pax: { adults: number; children: number; infants: number },
) {
  const a = result.perPax.adult;
  const c = result.perPax.child;
  const i = result.perPax.infant;
  const sumField = (k: keyof SearchResult['perPax']['adult']): number =>
    Number(a[k]) * pax.adults + Number(c[k]) * pax.children + Number(i[k]) * pax.infants;
  return {
    baseFarePaise: sumField('baseFarePaise'),
    taxesPaise: sumField('taxesPaise'),
    policyAdjustmentPaise: sumField('policyAdjustmentPaise'),
    platformMarkupPaise: sumField('platformMarkupPaise'),
    distributorMarkupPaise: sumField('distributorMarkupPaise'),
    agencyMarkupPaise: sumField('agencyMarkupPaise'),
    discountPaise: sumField('discountPaise'),
    gstPaise: sumField('gstPaise'),
    grossAmountPaise: sumField('grossAmountPaise'),
    netToSupplierPaise: sumField('netToSupplierPaise'),
    agencyPayablePaise: sumField('agencyPayablePaise'),
    distributorEarningsPaise: sumField('distributorEarningsPaise'),
    platformEarningsPaise: sumField('platformEarningsPaise'),
  };
}

export function serializeBooking(b: BookingDoc) {
  return {
    id: String(b._id),
    bookingCode: b.bookingCode,
    status: b.status,
    channel: b.channel,
    productType: 'FLIGHT' as const,
    flowSubType: b.flowSubType,
    pnr: b.pnr,
    airlinePnr: b.airlinePnr,
    ticketNumbers: b.ticketNumbers ?? [],
    agencyId: String(b.agencyId),
    agencyCode: b.agencyCode,
    agencyName: b.agencyName,
    distributorId: b.distributorId ? String(b.distributorId) : null,
    bookedByUserId: String(b.bookedByUserId),
    sector: b.sector,
    travelDate: b.travelDate.toISOString(),
    returnDate: b.returnDate ? b.returnDate.toISOString() : null,
    tripType: b.tripType,
    travelClass: b.travelClass,
    segments: (b.segments ?? []).map((s) => ({
      flightNumber: s.flightNumber,
      airline: s.airline,
      origin: s.origin,
      destination: s.destination,
      departure: s.departure.toISOString(),
      arrival: s.arrival.toISOString(),
      duration: s.duration,
      stopOver: s.stopOver ?? 0,
    })),
    passengers: (b.passengers ?? []).map((p) => ({
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      ticketNumber: p.ticketNumber ?? null,
      fareCategory: p.fareCategory,
    })),
    contact: {
      email: b.contact?.email ?? '',
      mobile: b.contact?.mobile ?? '',
      countryCode: b.contact?.countryCode ?? '+91',
    },
    gst: b.gst?.number
      ? {
          number: b.gst.number,
          companyName: b.gst.companyName ?? '',
          address: b.gst.address ?? '',
        }
      : null,
    pricing: { ...b.pricing!, currency: b.pricing?.currency ?? 'INR' },
    pricingTrace: b.pricingTrace ?? [],
    paymentMode: b.paymentMode,
    paymentStatus: b.paymentStatus,
    initiatedAt: b.initiatedAt ? b.initiatedAt.toISOString() : null,
    heldAt: b.heldAt ? b.heldAt.toISOString() : null,
    ticketedAt: b.ticketedAt ? b.ticketedAt.toISOString() : null,
    // ISO timestamp until which a TICKETED booking can be cancelled
    // at zero fee. Computed lazily from ticketedAt +
    // TRIPBNG_FLIGHT_VOID_WINDOW_HOURS so the UI doesn't need the env
    // value. Null when the booking isn't TICKETED or the env's window
    // is 0 (free void disabled).
    voidWindowEndsAt:
      b.ticketedAt && env.TRIPBNG_FLIGHT_VOID_WINDOW_HOURS > 0
        ? new Date(
            b.ticketedAt.getTime() +
              env.TRIPBNG_FLIGHT_VOID_WINDOW_HOURS * 60 * 60 * 1000,
          ).toISOString()
        : null,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
    refundedAt: b.refundedAt ? b.refundedAt.toISOString() : null,
    internalNotes: b.internalNotes,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}
