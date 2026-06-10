// DistributorTransfer — snapshot + state machine for distributor → sub-agent
// balance movements (spec §2.6 + §3.8 of AGENCY_WALLET_SYSTEM).
//
// One row per transfer attempt. Tracks the lifecycle:
//
//   PENDING_APPROVAL — created when amount > threshold (admin must approve)
//   COMPLETED        — both ledger legs landed atomically
//   REJECTED         — admin denied the pending request
//   REVERSED         — a RECALL transfer reversed an earlier COMPLETED one
//   FAILED           — execution attempted but compensation in flight; ops
//                      reconciles via the audit + ledger trail
//
// Why a row vs. just two ledger entries:
//   * Approval gating needs a pre-ledger record that's NOT money-affecting.
//   * Recall + reversal need a single anchor to point at when undoing a
//     previously-completed transfer.
//   * Per-distributor "transfers I made" reports are a single indexed lookup,
//     no ledger join required.
//   * Direction (TRANSFER vs RECALL) clarifies the semantics of the two
//     ledger legs without burdening WALLET_TXN_TYPE with a new variant.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const DistributorTransferSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },

    // Human-readable id ("DT-2026-05-20-000045") minted via the codes helper
    // and surfaced in admin UI + audit logs. Unique so retries of the same
    // attempt don't double-create rows.
    transferRef: { type: String, required: true, unique: true, index: true },

    // The two endpoints. For TRANSFER (the default), money flows
    // distributor → agency. For RECALL, the same fields name the parties
    // but the legs run in reverse (agency → distributor) — `originalTransferId`
    // points back to the COMPLETED row this is reversing.
    distributorId: { type: Schema.Types.ObjectId, ref: 'Distributor', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },

    amount: { type: Number, required: true, min: 1 },

    type: { type: String, enum: ['TRANSFER', 'RECALL'], required: true, default: 'TRANSFER' },

    status: {
      type: String,
      enum: ['PENDING_APPROVAL', 'COMPLETED', 'REJECTED', 'REVERSED', 'FAILED'],
      required: true,
      default: 'PENDING_APPROVAL',
      index: true,
    },

    // True if the amount crossed the configured approval threshold at the
    // time the transfer was requested. Snapshotted so a later threshold
    // change doesn't retroactively reinterpret the row.
    approvalRequired: { type: Boolean, default: false },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },

    // For RECALL: anchor back to the original TRANSFER this reverses. Null
    // for forward TRANSFER rows.
    originalTransferId: {
      type: Schema.Types.ObjectId,
      ref: 'DistributorTransfer',
      default: null,
      index: true,
    },

    // Once COMPLETED, the two WalletTransaction _ids that landed atomically.
    // outLedgerId = DEBIT side (distributor for TRANSFER, agency for RECALL).
    // inLedgerId  = CREDIT side (agency for TRANSFER, distributor for RECALL).
    outLedgerId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    inLedgerId: {
      type: Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },

    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: null },

    // When FAILED status is set, what went wrong (for ops triage).
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Pending-approval queue scan — admin dashboard hits this constantly.
DistributorTransferSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
// Distributor "my outgoing transfers" + agency "my incoming transfers".
DistributorTransferSchema.index({ tenantId: 1, distributorId: 1, createdAt: -1 });
DistributorTransferSchema.index({ tenantId: 1, agencyId: 1, createdAt: -1 });

export type DistributorTransferDoc = HydratedDocument<
  InferSchemaType<typeof DistributorTransferSchema>
> & { _id: Types.ObjectId };

export const DistributorTransfer: Model<DistributorTransferDoc> =
  (mongoose.models.DistributorTransfer as Model<DistributorTransferDoc> | undefined) ??
  model<DistributorTransferDoc>('DistributorTransfer', DistributorTransferSchema);
