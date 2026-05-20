// CreditSettlement — snapshot of every payment-waterfall outcome (spec §2.4
// AGENCY_WALLET_SYSTEM.md). One row per gateway deposit that touched a
// CREDIT-module wallet — captures BOTH legs of the split (how much settled
// outstanding credit, how much topped up the wallet) for audit and reporting.
//
// For non-CREDIT modules (CASH/DI/SUB_AGENT) we STILL write a row when the
// waterfall service runs, so a single collection drives the "deposit history"
// admin report — but `amountAppliedToCredit` is 0 in those rows.
//
// Why a separate collection vs. inferring from ledger:
//   * The two ledger entries (`CREDIT_SETTLEMENT` + `TOPUP`) are written
//     atomically inside a transaction, but reconstructing the pair on the
//     read path requires a join + filter. A single snapshot row is cheap to
//     write, trivial to query (one indexed lookup by pgReferenceId), and
//     gives ops a single source of truth for "what did this deposit do?".
//   * Future credit-exposure / DI-payout reports need the per-deposit split
//     without scanning the full ledger.

import mongoose, {
  Schema,
  model,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
  type Types,
} from 'mongoose';

const CreditSettlementSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    agencyId: { type: Schema.Types.ObjectId, ref: 'Agency', required: true, index: true },

    // Gateway-side identity for idempotency + cross-system audit. `pgReferenceId`
    // mirrors the same field on `WalletTransaction` so a snapshot row joins to
    // both ledger entries it summarises.
    pgReferenceId: { type: String, required: true },
    pgGateway: {
      type: String,
      enum: ['ICICI_ORANGE_PG', 'PHONEPE', 'MANUAL'],
      required: true,
    },

    // All money in paise. amountReceived = amountAppliedToCredit + amountAppliedToWallet
    // — enforced by the service layer, asserted by the integrity check.
    amountReceived: { type: Number, required: true, min: 0 },
    amountAppliedToCredit: { type: Number, required: true, min: 0, default: 0 },
    amountAppliedToWallet: { type: Number, required: true, min: 0, default: 0 },

    // Pre/post snapshots for both buckets — captured at commit-time inside the
    // transaction, so reports can show "before this payment, the agency owed X;
    // after, it owes Y".
    creditBalanceBefore: { type: Number, required: true, min: 0 },
    creditBalanceAfter: { type: Number, required: true, min: 0 },
    walletBalanceBefore: { type: Number, required: true },
    walletBalanceAfter: { type: Number, required: true },

    // Ledger entries written by the same waterfall txn. Up to 2 (CREDIT_SETTLEMENT
    // + TOPUP) — exactly 2 when both legs are non-zero, exactly 1 otherwise.
    ledgerEntryIds: { type: [{ type: Schema.Types.ObjectId, ref: 'WalletTransaction' }], default: [] },

    // Module the agency was in when the waterfall fired. Snapshotted so a later
    // module switch doesn't change the historical interpretation of the row.
    agencyModuleAtTime: {
      type: String,
      enum: ['CREDIT', 'DI', 'CASH', 'DISTRIBUTOR', 'SUB_AGENT'],
      required: true,
    },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

// Unique by (tenant, agency, pgReferenceId) — idempotency guarantee for the
// waterfall: a second webhook for the same gateway txn finds an existing row
// and short-circuits without re-applying the split.
CreditSettlementSchema.index(
  { tenantId: 1, agencyId: 1, pgReferenceId: 1 },
  { unique: true },
);
// Admin "deposits today" / "credit settlements in date range" queries.
CreditSettlementSchema.index({ tenantId: 1, createdAt: -1 });

export type CreditSettlementDoc = HydratedDocument<
  InferSchemaType<typeof CreditSettlementSchema>
> & { _id: Types.ObjectId };

export const CreditSettlement: Model<CreditSettlementDoc> =
  (mongoose.models.CreditSettlement as Model<CreditSettlementDoc> | undefined) ??
  model<CreditSettlementDoc>('CreditSettlement', CreditSettlementSchema);
