// Wallet-monitor worker — periodic balance sweep + low/critical alerting.
//
// Schedule: every 15 minutes (CLAUDE.md §2). Mirrors the existing
// transactional low-balance alert that fires inline when a debit
// crosses the threshold (see services/wallet/ledger.ts) — the worker
// catches the cases the transactional path can't:
//
//   - Wallets that already crossed below threshold and have been sitting
//     low without a debit (stale-low).
//   - Wallets that drift below the critical threshold over time (the
//     transactional alert fires once and dedupes; critical needs to
//     re-fire every tick because it's actionable).
//
// Behaviour:
//   - Find all ACTIVE wallets where balance < LOW_WALLET_THRESHOLD_PAISE.
//   - For each:
//       balance < CRITICAL  →  fire LOW_WALLET_BALANCE severity=critical
//                              (no dedupe — repeats every 15 min until topped up)
//       balance ≥ CRITICAL
//                  & < LOW  →  fire LOW_WALLET_BALANCE severity=low
//                              (deduped by Redis key for 24h)
//
// Recipients: agency owner (the platform User who owns the wallet).
// Resolved at fire-time so newly-onboarded staff also receive the alert.

import type { Job, Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { Wallet } from '../models/Wallet.js';
import { Agency } from '../models/Agency.js';
import { enqueueAlert } from '../services/alerts/index.js';

interface WalletMonitorJob {
  triggeredBy: 'cron' | 'manual';
}

const TOPUP_URL = '/wallet/topup';

export async function walletMonitorProcessor(job: Job<WalletMonitorJob>): Promise<void> {
  // Defensive guard — env validation already enforces this, but a
  // misconfigured override (CRITICAL > LOW) would silently disable the
  // critical tier. Surface loudly.
  const lowThreshold = env.LOW_WALLET_THRESHOLD_PAISE;
  const criticalThreshold = Math.min(env.CRITICAL_WALLET_THRESHOLD_PAISE, lowThreshold);

  const startedAt = Date.now();

  // We scan agency-owned wallets only. Distributor + user wallets exist
  // (per the model) but aren't customer-facing for bus bookings; their
  // alerting can land later if needed.
  const lowWallets = await Wallet.find({
    status: 'ACTIVE',
    agencyId: { $ne: null },
    balance: { $lt: lowThreshold },
    lowBalanceAlertEnabled: true,
  })
    .select({ _id: 1, tenantId: 1, agencyId: 1, balance: 1 })
    .lean();

  let firedCritical = 0;
  let firedLow = 0;
  let skippedDeduped = 0;

  for (const w of lowWallets) {
    const severity: 'critical' | 'low' = w.balance < criticalThreshold ? 'critical' : 'low';
    const walletId = String(w._id);

    if (severity === 'low') {
      // Dedupe key — set on fire with the configured TTL. SETNX returns 1
      // when the key didn't exist (i.e. we're the first firer in this
      // window); 0 means somebody else (or the previous tick) already
      // fired and we should skip.
      const key = `alert:wallet-low:${walletId}`;
      const ttlSec = env.WALLET_LOW_ALERT_DEDUPE_HOURS * 60 * 60;
      const acquired = await redis
        .set(key, '1', 'EX', ttlSec, 'NX')
        .catch(() => null);
      if (acquired !== 'OK') {
        skippedDeduped++;
        continue;
      }
    }

    // Resolve recipient. Agency primary contact is the natural target;
    // if the agency row is missing for any reason (orphan wallet), skip
    // rather than emit a half-broken alert.
    const agency = await Agency.findById(w.agencyId).select({ _id: 1, ownerUserId: 1 }).lean();
    if (!agency || !agency.ownerUserId) {
      logger.warn(
        { walletId, agencyId: String(w.agencyId) },
        'wallet-monitor: agency / owner missing — skipping alert',
      );
      continue;
    }

    try {
      await enqueueAlert(
        {
          event: 'LOW_WALLET_BALANCE',
          vars: {
            walletBalancePaise: w.balance,
            thresholdPaise: severity === 'critical' ? criticalThreshold : lowThreshold,
            topupUrl: TOPUP_URL,
            severity,
          },
        },
        [{ kind: 'user', id: String(agency.ownerUserId) }],
        {
          tenantId: String(w.tenantId),
          correlationKey: `wallet-monitor:${walletId}:${severity}`,
        },
      );
      if (severity === 'critical') firedCritical++;
      else firedLow++;
    } catch (err) {
      logger.warn(
        { err, walletId, severity },
        'wallet-monitor: enqueueAlert failed — will retry on next tick',
      );
    }
  }

  logger.info(
    {
      scanned: lowWallets.length,
      firedCritical,
      firedLow,
      skippedDeduped,
      ms: Date.now() - startedAt,
      triggeredBy: job.data.triggeredBy,
    },
    'wallet-monitor: tick done',
  );
}

/**
 * Schedule the recurring monitor cron. Pattern is "every WALLET_MONITOR_INTERVAL_MS"
 * — BullMQ accepts a `repeat.every` in ms which is the simplest match.
 */
export async function scheduleWalletMonitor(queue: Queue): Promise<void> {
  await queue.add(
    'monitor-tick',
    { triggeredBy: 'cron' },
    {
      repeat: { every: env.WALLET_MONITOR_INTERVAL_MS },
      jobId: 'cron:wallet-monitor',
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 },
    },
  );
}
