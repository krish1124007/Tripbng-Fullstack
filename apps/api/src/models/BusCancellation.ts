// BusCancellation — one row per cancellation event against a BusBooking.
//
// Why a separate collection (vs. a flag on BusBooking):
//   - Partial cancellations stack — a booking can have several rows
//     (e.g. 2 seats now, 1 more seat next day). Inlining would
//     overwrite history.
//   - Audit-friendly: ops can see "cancellation X charged ₹Y to refund
//     ₹Z, reason was BUS_CANCELLATION" without scrolling through the
//     booking's stateHistory.
//   - Refund-txn linkage: each cancellation row holds the wallet txn
//     id, which finance reconciles independently from booking state.
//
// Money convention: integer PAISE everywhere. Spec §5.8 lists Decimal128
// — overridden to match the rest of TripBNG.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const BUS_CANCELLATION_REASONS = [
  /** User-initiated via the app. The wallet refund honours the
   *  cancellation policy slabs from the trip's policyString. */
  'USER',
  /** Operator cancelled the entire trip — full refund (incl. OSC). */
  'BUS_CANCELLATION',
  /** Booking office cancellation — operator-side admin action. */
  'BO_CANCELLATION',
  /** Operator rerouted / arranged a substitute — partial refund. */
  'ALTERNATE_ARRANGEMENT',
] as const;
export type BusCancellationReason = (typeof BUS_CANCELLATION_REASONS)[number];

export const BUS_CANCELLATION_STATUS = ['INITIATED', 'COMPLETED', 'FAILED'] as const;
export type BusCancellationStatus = (typeof BUS_CANCELLATION_STATUS)[number];

const BusCancellationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'BusBooking',
      required: true,
      index: true,
    },

    /** Subset of the original booking's seats that this row cancelled.
     *  When the cancellation is operator-side, this is the full seat list. */
    seatsCancelled: { type: [String], required: true, validate: (v: string[]) => v.length >= 1 },

    /** Charge withheld from the refund. 0 for operator-side cancellations. */
    cancellationChargePaise: { type: Number, default: 0, min: 0 },
    /** Net refund credited to the wallet. */
    refundAmountPaise: { type: Number, default: 0, min: 0 },

    reason: { type: String, enum: BUS_CANCELLATION_REASONS, required: true, index: true },

    /** SeatSeller raw response — kept verbatim for ops disputes / debug. */
    rawResponse: { type: Schema.Types.Mixed, default: null },

    /** Wallet credit transaction id. Set after the refund posts. Null when
     *  the row is INITIATED but the wallet write failed (FAILED status). */
    refundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    status: {
      type: String,
      enum: BUS_CANCELLATION_STATUS,
      default: 'INITIATED',
      required: true,
      index: true,
    },

    /** SeatSeller-side reference for the cancellation, if returned. */
    cancellationReference: { type: String, default: null },

    /** Who initiated the cancellation. Null for operator-side rows
     *  (the poller writes those without a human actor). */
    initiatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    /** Free-form note: user-supplied reason (User cancel) or
     *  operator's `cancellationMessage` (operator cancel). */
    note: { type: String, default: '' },

    /** When SeatSeller's confirmation landed. May lag by hours after
     *  the operator-side cron picks it up. */
    confirmedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

BusCancellationSchema.index({ tenantId: 1, bookingId: 1, createdAt: -1 });
BusCancellationSchema.index({ status: 1, createdAt: 1 });

export type BusCancellationDoc = HydratedDocument<InferSchemaType<typeof BusCancellationSchema>> & {
  _id: Types.ObjectId;
};
export type BusCancellationModel = Model<InferSchemaType<typeof BusCancellationSchema>>;
export const BusCancellation: BusCancellationModel =
  (mongoose.models.BusCancellation as BusCancellationModel | undefined) ??
  model<InferSchemaType<typeof BusCancellationSchema>>('BusCancellation', BusCancellationSchema);
