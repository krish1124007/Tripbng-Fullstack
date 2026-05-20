// Balance reader — single source of truth for "what's the agency's wallet
// balance right now" (spec §3.1 cutover, Phase 15).
//
// Background: the system originally stored balance on `Agency.walletBalance`.
// Phase-1 introduced the dedicated `Wallet` collection as the new authoritative
// source, and every wallet-mutating service dual-writes to both fields. This
// module is the read-side cutover: callers ask balance-reader for the number
// and we return it from Wallet first, falling back to Agency for stragglers
// that haven't been touched since Phase 0.
//
// Why not just drop Agency.walletBalance now:
//   - The Phase-9 backfill is past us, but the dual-write safety net is still
//     in place across waterfall + ledger + transfer. A single missed write
//     would surface as a balance discrepancy on the agency screen — better
//     to keep the fallback and let the daily integrity worker catch drift.
//   - This module gives us a clean seam to flip when we're ready to drop
//     the legacy field — just delete the fallback branch and we're done.
//
// Callers should hit `readAgencyBalance` (single) or `readAgencyBalances`
// (batch — use this whenever rendering a list of agencies, the batch
// avoids the N+1 wallet lookup).

import type { Types } from 'mongoose';
import { Agency } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';

/**
 * Read one agency's wallet balance. Returns 0 when the agency has no wallet
 * row AND no legacy Agency.walletBalance (which means the agency was created
 * but never funded — a valid state).
 */
export async function readAgencyBalance(
  agencyId: string | Types.ObjectId,
): Promise<number> {
  const w = await Wallet.findOne({ agencyId }).select('balance').lean();
  if (w) return w.balance ?? 0;
  // Fallback to the legacy field. Should be vanishingly rare post-backfill;
  // logging it would be noisy, so the daily integrity worker is the right
  // place to flag stragglers (it already does).
  const a = await Agency.findById(agencyId).select('walletBalance').lean();
  return a?.walletBalance ?? 0;
}

/**
 * Batch read — single Mongo round-trip per collection (one Wallet.find +
 * at most one Agency.find for any missing IDs). Use this on list endpoints
 * to avoid an N+1 wallet lookup.
 *
 * Returns a Map keyed by agency `_id.toString()` so the caller can join by
 * the same string they're already serialising.
 */
export async function readAgencyBalances(
  agencyIds: ReadonlyArray<string | Types.ObjectId>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (agencyIds.length === 0) return result;

  const wallets = await Wallet.find({ agencyId: { $in: agencyIds as Types.ObjectId[] } })
    .select('agencyId balance')
    .lean();
  for (const w of wallets) {
    if (w.agencyId) result.set(String(w.agencyId), w.balance ?? 0);
  }

  // Anything still missing — fall back to the legacy field.
  const missing = agencyIds.filter((id) => !result.has(String(id))) as Types.ObjectId[];
  if (missing.length > 0) {
    const agencies = await Agency.find({ _id: { $in: missing } })
      .select('_id walletBalance')
      .lean();
    for (const a of agencies) {
      result.set(String(a._id), a.walletBalance ?? 0);
    }
  }

  return result;
}
