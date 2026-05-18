// Cancellation job state — one row per cancel attempt.
//
// TBO's cancel pathway is async: SendChangeRequest fires + returns a
// ChangeRequestId, then we poll GetChangeRequestStatus until it becomes
// Processed (3) or Rejected (4). This collection tracks the poll loop.
//
// Why a separate collection (vs. fields on HotelBooking): one booking can
// have multiple cancel attempts over its lifetime (rejected, then re-tried
// after support intervention). Keeping the history on its own model gives
// us a clean audit trail without mutating the booking row.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

export const CANCEL_JOB_STATUS = [
  'NotSet',
  'Pending',
  'InProgress',
  'Processed',
  'Rejected',
] as const;
export type CancelJobStatus = (typeof CANCEL_JOB_STATUS)[number];

const HotelCancellationJobSchema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: 'HotelBooking',
      required: true,
      index: true,
    },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    /** Numeric BookingId TBO assigned at Book time. */
    supplierBookingId: { type: Number, required: true },
    /** TBO's ChangeRequestId — null until SendChangeRequest succeeds. */
    changeRequestId: { type: Number, default: null, index: true },
    changeRequestStatus: {
      type: String,
      enum: CANCEL_JOB_STATUS,
      default: 'Pending',
      index: true,
    },
    remarks: { type: String, required: true },
    /** Cancellation charge per the latest GetChangeRequestStatus poll. Stored
     *  in paise (rupees * 100). */
    cancellationChargePaise: { type: Number, default: 0 },
    /** Refund amount per the latest poll. */
    refundAmountPaise: { type: Number, default: 0 },
    /** Whether we've already credited the refund to the agency wallet —
     *  guards against double-refund on duplicate Processed responses. */
    refundCreditedAt: { type: Date, default: null },
    walletRefundTxnId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },

    pollAttempts: { type: Number, default: 0 },
    lastPolledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

export type HotelCancellationJobDoc = HydratedDocument<
  InferSchemaType<typeof HotelCancellationJobSchema>
> & { _id: Types.ObjectId };
export const HotelCancellationJob: Model<HotelCancellationJobDoc> =
  (mongoose.models.HotelCancellationJob as Model<HotelCancellationJobDoc> | undefined) ??
  model<HotelCancellationJobDoc>('HotelCancellationJob', HotelCancellationJobSchema);
