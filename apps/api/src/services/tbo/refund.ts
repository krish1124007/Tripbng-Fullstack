// Wallet-refund helper for failed hotel bookings.
//
// Used when:
//   - Book transport fails (book.service catch block)
//   - TBO returns Status=2/5 (book.service failed branch)
//   - VerifyPrice — refund + ask user to re-confirm (book.service)
//   - Pending-poll resolves to SUPPLIER_FAILED / SUPPLIER_CANCELLED
//     (pending-booking-poll.worker)
//
// Correctness contracts:
//   - Idempotent on `walletRefundTxnId` — calling twice never double-refunds.
//   - Idempotent on `walletDebitTxnId` — if no debit was posted, no-op.
//   - On postCredit failure: logger.fatal + swallow. Real money is at risk;
//     ops reconciles via the wallet ledger. Re-throwing would leave the
//     booking in a half-state (status BOOK_FAILED but no refund).
//
// Caller contract:
//   - Mutates `doc.walletRefundTxnId` in place; does NOT save the doc.
//     The caller batches this with their own save() (status transition,
//     statusHistory push, etc.) so a single Mongo write captures both.

import { logger } from '../../config/logger.js';
import type { HotelBookingDoc } from '../../models/HotelBooking.js';
import { postCredit } from '../wallet/ledger.js';

export interface RefundArgs {
  doc: HotelBookingDoc;
  amountPaise: number;
  description: string;
  /** Wallet-ledger attribution — usually the original booker, sometimes
   *  a system user (cron). */
  performedByUserId: string;
  /** Optional IP for audit. */
  ipAddress?: string | null;
}

export interface RefundResult {
  /** 'credited' = credit posted; 'skipped' = no debit / already refunded;
   *  'failed' = postCredit threw (logged loudly, ops reconciliation). */
  outcome: 'credited' | 'skipped' | 'failed';
  reason?: string;
}

/**
 * Refund the wallet debit posted at Book time. Mutates `doc.walletRefundTxnId`
 * in place when a credit is posted. Caller saves.
 */
export async function refundHotelBookingDebit(args: RefundArgs): Promise<RefundResult> {
  const { doc } = args;

  if (!doc.walletDebitTxnId) {
    return { outcome: 'skipped', reason: 'no debit posted' };
  }
  if (doc.walletRefundTxnId) {
    return { outcome: 'skipped', reason: 'already refunded' };
  }
  if (!doc.agencyId) {
    return { outcome: 'skipped', reason: 'no agencyId on booking' };
  }
  if (args.amountPaise <= 0) {
    return { outcome: 'skipped', reason: 'non-positive refund amount' };
  }

  try {
    const credit = await postCredit({
      tenantId: String(doc.tenantId),
      walletKind: 'AGENCY',
      walletOwnerId: String(doc.agencyId),
      type: 'REFUND_CREDIT',
      amountPaise: args.amountPaise,
      performedBy: args.performedByUserId,
      description: args.description,
      relatedTxnId: String(doc.walletDebitTxnId),
      metadata: { hotelBookingId: String(doc._id) },
      ipAddress: args.ipAddress ?? null,
    });
    doc.walletRefundTxnId = credit._id;
    return { outcome: 'credited' };
  } catch (err) {
    // P0 — agency was charged for a booking they didn't get. Surface loudly;
    // ops reconciles from the ledger.
    logger.fatal(
      {
        err,
        bookingId: String(doc._id),
        agencyId: String(doc.agencyId),
        amountPaise: args.amountPaise,
        description: args.description,
      },
      'tbo.refund: REFUND CREDIT FAILED — manual reconciliation required',
    );
    return {
      outcome: 'failed',
      reason: err instanceof Error ? err.message : 'unknown',
    };
  }
}
