// Wallet integrity check — daily cron, spec AGENCY_WALLET_SYSTEM §10.
//
// Recomputes each agency's wallet balance from the `wallettransactions` ledger
// and compares against the cached projection (`Agency.walletBalance` and
// `Wallet.balance`). Any drift > 0 paise gets logged + audited + (eventually)
// alerted, so an operator can investigate before the discrepancy compounds.
//
// Why we check BOTH stores
//   The repo currently dual-writes wallet balances (see gap-analysis Conflict 1)
//   — `services/wallet/ledger.ts` writes `Agency.walletBalance`, while the
//   `Wallet` model exposes `balance + version`. We compare the ledger sum
//   against both so this job continues to work whichever store wins. It also
//   means we'd immediately catch a dual-write inconsistency between the two
//   stores — exactly the kind of bug Conflict 1 risks.
//
// Bucket awareness
//   This Phase-1 cut checks the WALLET bucket only. Legacy ledger entries have
//   `bucket` unset; the aggregation treats those as WALLET via `$ifNull`. Once
//   credit module starts emitting CREDIT-bucket rows we'll extend this to
//   `creditBalance` integrity too.
//
// What "drift" means
//   `drift = storedBalance − ledgerSum`. Positive drift means the cached
//   balance is too high (ledger sum is lower — agency was over-credited or
//   under-debited). Negative drift means the cache is too low. Zero is healthy.

import mongoose, { type Types } from 'mongoose';
import { Agency } from '../../models/Agency.js';
import { Wallet } from '../../models/Wallet.js';
import { WalletTransaction } from '../../models/WalletTransaction.js';
import { logger } from '../../config/logger.js';
import { recordAudit } from '../audit.service.js';

export interface AgencyIntegrityRow {
  /** Agency ObjectId as string. */
  agencyId: string;
  /** Tenant the agency belongs to (for downstream alerts/audit). */
  tenantId: string;
  /** Net of all WALLET-bucket ledger entries: CREDIT − DEBIT, in paise. */
  ledgerSumPaise: number;
  /** `Agency.walletBalance` cache value, in paise. Null if agency missing. */
  agencyCachedPaise: number | null;
  /** `Wallet.balance` cache value, in paise. Null if no Wallet doc for the agency. */
  walletCachedPaise: number | null;
  /** Drift on the Agency cache: `agencyCached − ledgerSum`. Null when cache missing. */
  driftAgencyPaise: number | null;
  /** Drift on the Wallet cache: `walletCached − ledgerSum`. Null when cache missing. */
  driftWalletPaise: number | null;
  /** Drift between the two caches: `agencyCached − walletCached`. Catches dual-write bugs. */
  driftBetweenCachesPaise: number | null;
}

export interface IntegrityReport {
  scannedAgencies: number;
  driftedAgencies: number;
  rows: AgencyIntegrityRow[];
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
}

export interface RunIntegrityCheckOptions {
  /** Restrict to a specific tenant (default: all tenants). */
  tenantId?: string;
  /** Restrict to a specific list of agencies (default: all with ledger entries). */
  agencyIds?: string[];
  /**
   * Suppress audit-log + warn-log noise when running ad-hoc (e.g. from a test
   * or the manual admin trigger).
   */
  dryRun?: boolean;
}

/**
 * Run the integrity check across the requested scope and return the report.
 * The caller decides what to do with the result — the daily-cron worker
 * persists audit rows + logs; an admin "check now" endpoint may render it.
 */
export async function runIntegrityCheck(
  opts: RunIntegrityCheckOptions = {},
): Promise<IntegrityReport> {
  const startedAt = new Date();

  // 1. Load ALL agencies in scope first. This is the universe we check —
  //    agencies that have ledger entries AND agencies that don't (the
  //    "orphan cache" case: a non-zero `walletBalance` with no ledger row
  //    at all, typically from a seeded opening balance).
  const agencyFilter: Record<string, unknown> = {};
  if (opts.tenantId) {
    agencyFilter.tenantId = new mongoose.Types.ObjectId(opts.tenantId);
  }
  if (opts.agencyIds && opts.agencyIds.length > 0) {
    agencyFilter._id = {
      $in: opts.agencyIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }
  const agencyDocs = await Agency.find(agencyFilter)
    .select({ _id: 1, tenantId: 1, walletBalance: 1 })
    .lean();

  // 2. Aggregate ledger sums for those agencies, and pull the Wallet docs.
  const agencyObjectIds = agencyDocs.map((a) => a._id);
  const [ledgerSums, walletDocs] = await Promise.all([
    aggregateLedgerSums(agencyObjectIds),
    Wallet.find({ agencyId: { $in: agencyObjectIds } })
      .select({ _id: 1, agencyId: 1, balance: 1, version: 1 })
      .lean(),
  ]);
  const sumByAgency = new Map(ledgerSums.map((r) => [String(r._id), r.sum]));
  const walletByAgency = new Map(walletDocs.map((w) => [String(w.agencyId), w]));

  // 3. Build a row per agency. We deliberately include agencies with zero
  //    ledger sum AND zero cache — the row is benign (no drift) but the
  //    `lastReconciledAt` write below still bumps to confirm coverage.
  const rows: AgencyIntegrityRow[] = agencyDocs.map((a) => {
    const id = String(a._id);
    const sum = sumByAgency.get(id) ?? 0;
    const wallet = walletByAgency.get(id);
    const agencyCached = a.walletBalance ?? 0;
    const walletCached = wallet?.balance ?? null;
    return {
      agencyId: id,
      tenantId: String(a.tenantId),
      ledgerSumPaise: sum,
      agencyCachedPaise: agencyCached,
      walletCachedPaise: walletCached,
      driftAgencyPaise: agencyCached - sum,
      driftWalletPaise: walletCached === null ? null : walletCached - sum,
      driftBetweenCachesPaise: walletCached === null ? null : agencyCached - walletCached,
    };
  });

  const driftedAgencies = rows.filter((r) => hasDrift(r)).length;
  const finishedAt = new Date();
  const report: IntegrityReport = {
    scannedAgencies: rows.length,
    driftedAgencies,
    rows,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  if (!opts.dryRun) {
    await persistFindings(report);
  }
  return report;
}

/** True when any of the three drift values are non-zero (and not null). */
export function hasDrift(row: AgencyIntegrityRow): boolean {
  return (
    (row.driftAgencyPaise !== null && row.driftAgencyPaise !== 0) ||
    (row.driftWalletPaise !== null && row.driftWalletPaise !== 0) ||
    (row.driftBetweenCachesPaise !== null && row.driftBetweenCachesPaise !== 0)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerSumRow {
  _id: Types.ObjectId;
  sum: number;
}

async function aggregateLedgerSums(
  agencyIds: mongoose.Types.ObjectId[],
): Promise<LedgerSumRow[]> {
  if (agencyIds.length === 0) return [];
  const pipeline: mongoose.PipelineStage[] = [
    { $match: { agencyId: { $in: agencyIds } } },
    {
      // Treat legacy rows (no `bucket` set) as WALLET — matches the post-schema
      // default we set in Phase-1 step 5. We explicitly include them so the
      // sum is correct even for ledger rows written before this migration.
      $match: {
        $or: [
          { bucket: 'WALLET' },
          { bucket: { $exists: false } },
          { bucket: null },
        ],
      },
    },
    {
      $group: {
        _id: '$agencyId',
        sum: {
          $sum: {
            $cond: [
              { $eq: ['$direction', 'CREDIT'] },
              '$amount',
              { $multiply: ['$amount', -1] },
            ],
          },
        },
      },
    },
  ];

  return (await WalletTransaction.aggregate(pipeline)) as LedgerSumRow[];
}

async function persistFindings(report: IntegrityReport): Promise<void> {
  // Update reconciliation timestamps for every WALLET we touched, drift or no.
  // Lets ops see "when was this last verified" in admin UI.
  const walletUpdates = await Wallet.find({
    agencyId: { $in: report.rows.map((r) => new mongoose.Types.ObjectId(r.agencyId)) },
  })
    .select({ _id: 1, agencyId: 1, balance: 1 })
    .lean();
  if (walletUpdates.length > 0) {
    await Wallet.updateMany(
      { _id: { $in: walletUpdates.map((w) => w._id) } },
      { $set: { lastReconciledAt: report.finishedAt } },
    );
    // Per-wallet lastReconciledBalance has to land separately since updateMany
    // can't set a different value per doc in one call. The Wallet collection
    // is small enough (<10k rows for now) that the round-trips are fine.
    for (const w of walletUpdates) {
      await Wallet.updateOne(
        { _id: w._id },
        { $set: { lastReconciledBalance: w.balance } },
      );
    }
  }

  // Audit + loud-log every drifted agency.
  const drifted = report.rows.filter(hasDrift);
  for (const row of drifted) {
    logger.error(
      {
        agencyId: row.agencyId,
        ledgerSumPaise: row.ledgerSumPaise,
        agencyCachedPaise: row.agencyCachedPaise,
        walletCachedPaise: row.walletCachedPaise,
        driftAgencyPaise: row.driftAgencyPaise,
        driftWalletPaise: row.driftWalletPaise,
        driftBetweenCachesPaise: row.driftBetweenCachesPaise,
      },
      'wallet-integrity: drift detected',
    );
    try {
      await recordAudit({
        tenantId: row.tenantId,
        actorId: null,
        actorRole: 'SYSTEM',
        action: 'wallet.integrity_drift',
        resource: 'agency',
        resourceId: row.agencyId,
        before: {
          // "before" = stored cached values prior to detection
          agencyWalletBalancePaise: row.agencyCachedPaise,
          walletBalancePaise: row.walletCachedPaise,
        },
        after: {
          // "after" = what the ledger says the cache SHOULD be
          ledgerSumPaise: row.ledgerSumPaise,
          driftAgencyPaise: row.driftAgencyPaise,
          driftWalletPaise: row.driftWalletPaise,
          driftBetweenCachesPaise: row.driftBetweenCachesPaise,
        },
        success: false,
        error: 'drift',
      });
    } catch (err) {
      // Audit failures must never break the cron — but we shout.
      logger.error({ err, agencyId: row.agencyId }, 'wallet-integrity: failed to audit drift');
    }
  }

  logger.info(
    {
      scanned: report.scannedAgencies,
      drifted: report.driftedAgencies,
      durationMs: report.durationMs,
    },
    'wallet-integrity: tick done',
  );
}

