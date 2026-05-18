// Reconciliation matcher — daily cron compares gateway-side records to our
// PaymentTransaction collection. Spec §8.
//
// Inputs:
//   - SettlementBatch row uploaded by ops (CSV from gateway).
//   - For each row in the CSV: gateway_txn_id, amount, status, mdr, gst, utr.
//
// Outputs:
//   - Per-row match: linked PT promoted to SUCCESS if needed, mismatched fields
//     captured, batch.reconciledCount + discrepancyCount updated.
//   - Discrepancy rows recorded so the (deferred) admin UI can render them.
//   - Email alert when discrepancyCount > 0.
//
// This module focuses on the matcher; the cron schedule + CSV ingest land
// alongside the admin UI in Phase 6 follow-up.

import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { captureMessage } from '../../config/sentry.js';
import {
  PaymentTransaction,
  type PaymentTransactionDoc,
} from '../../models/PaymentTransaction.js';
import { SettlementBatch, type SettlementBatchDoc } from '../../models/SettlementBatch.js';
import { runWithoutTenant } from '../../middleware/tenant-context.js';
import { paymentService } from './payment.service.js';

export interface GatewayRow {
  gatewayTxnId: string;
  amount: number; // paise
  status: 'SUCCESS' | 'FAILED' | 'REFUNDED';
  mdrAmount?: number;
  gstOnMdr?: number;
  settlementUtr?: string;
  rawRow: Record<string, unknown>;
}

export interface DiscrepancyRow {
  kind:
    | 'AMOUNT_MISMATCH'
    | 'STATUS_MISMATCH'
    | 'GATEWAY_HAS_NO_PT'
    | 'PT_NOT_IN_GATEWAY'
    | 'OK_RESOLVED_FROM_PENDING';
  gatewayTxnId?: string;
  paymentTxnCode?: string;
  detail: string;
  ourAmount?: number;
  gatewayAmount?: number;
  ourStatus?: string;
  gatewayStatus?: string;
}

export interface ReconciliationReport {
  batchId: string;
  matchedCount: number;
  resolvedCount: number; // promoted PENDING→SUCCESS based on gateway
  discrepancyCount: number;
  discrepancies: DiscrepancyRow[];
}

/**
 * Match a parsed gateway batch against our PaymentTransaction records.
 *
 * Wrapped in `runWithoutTenant()` because the matcher inherently spans every
 * tenant — gateway settlement files don't carry our tenant id. Each PT is
 * looked up by `gatewayTxnId` (which is unique across our universe per
 * provider).
 */
export async function reconcileBatch(
  batchId: Types.ObjectId,
  rows: GatewayRow[],
): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    batchId: batchId.toHexString(),
    matchedCount: 0,
    resolvedCount: 0,
    discrepancyCount: 0,
    discrepancies: [],
  };

  await runWithoutTenant(async () => {
    const batch = await SettlementBatch.findById(batchId);
    if (!batch) throw new Error(`SettlementBatch ${batchId} not found`);

    // Build a Set of gatewayTxnIds we've seen so we can later flag PTs that
    // SHOULD have been in the gateway file but weren't.
    const seenGatewayTxnIds = new Set<string>();

    for (const row of rows) {
      seenGatewayTxnIds.add(row.gatewayTxnId);
      try {
        await reconcileOneRow(batch.providerCode, row, report);
      } catch (err) {
        logger.error({ err, gatewayTxnId: row.gatewayTxnId }, 'reconcileOneRow failed');
        report.discrepancies.push({
          kind: 'AMOUNT_MISMATCH',
          gatewayTxnId: row.gatewayTxnId,
          detail: `processing error: ${err instanceof Error ? err.message : 'unknown'}`,
        });
        report.discrepancyCount++;
      }
    }

    // PTs we think succeeded that aren't in the gateway file at all.
    const ourTerminalForBatch = await PaymentTransaction.find({
      providerCode: batch.providerCode,
      status: 'SUCCESS',
      completedAt: {
        $gte: startOfDay(batch.batchDate),
        $lt: nextDay(batch.batchDate),
      },
    })
      .select('txnCode gatewayTxnId amount')
      .lean();

    for (const pt of ourTerminalForBatch) {
      if (pt.gatewayTxnId && !seenGatewayTxnIds.has(pt.gatewayTxnId)) {
        report.discrepancies.push({
          kind: 'PT_NOT_IN_GATEWAY',
          paymentTxnCode: pt.txnCode,
          detail: `we recorded SUCCESS but no row in gateway settlement for ${pt.gatewayTxnId}`,
          ourAmount: pt.amount,
        });
        report.discrepancyCount++;
      }
    }

    batch.actualTransactionCount = rows.length;
    batch.reconciledCount = report.matchedCount;
    batch.discrepancyCount = report.discrepancyCount;
    batch.status = report.discrepancyCount === 0 ? 'RECONCILED' : 'DISCREPANT';
    batch.reconciledAt = new Date();
    await batch.save();
  });

  if (report.discrepancyCount > 0) {
    captureMessage('reconciliation-discrepancies', 'warn', {
      tags: { batchId: report.batchId, count: String(report.discrepancyCount) },
      extra: { discrepancies: report.discrepancies.slice(0, 10) },
    });
    await emailFinanceTeam(report).catch((err) =>
      logger.warn({ err }, 'failed to email finance team about discrepancies (non-fatal)'),
    );
  }

  return report;
}

async function reconcileOneRow(
  providerCode: SettlementBatchDoc['providerCode'],
  row: GatewayRow,
  report: ReconciliationReport,
): Promise<void> {
  const pt = await PaymentTransaction.findOne({
    providerCode,
    gatewayTxnId: row.gatewayTxnId,
  });

  if (!pt) {
    report.discrepancies.push({
      kind: 'GATEWAY_HAS_NO_PT',
      gatewayTxnId: row.gatewayTxnId,
      gatewayAmount: row.amount,
      gatewayStatus: row.status,
      detail: 'gateway has a row we have no PaymentTransaction for',
    });
    report.discrepancyCount++;
    return;
  }

  // Always trust the gateway on amount + status. The gateway is the source of
  // truth for what actually happened with money.

  const amountOk = pt.amount === row.amount;
  if (!amountOk) {
    report.discrepancies.push({
      kind: 'AMOUNT_MISMATCH',
      gatewayTxnId: row.gatewayTxnId,
      paymentTxnCode: pt.txnCode,
      ourAmount: pt.amount,
      gatewayAmount: row.amount,
      detail: 'amount on PT differs from gateway settlement row',
    });
    report.discrepancyCount++;
    // Don't auto-correct — humans investigate.
  }

  // Recovery: gateway says SUCCESS but our PT is PENDING/PROCESSING/TIMEOUT.
  // This is the whole point of reconciliation — promote the PT and credit
  // the wallet retroactively.
  if (
    row.status === 'SUCCESS' &&
    (pt.status === 'PENDING' || pt.status === 'PROCESSING' || pt.status === 'TIMEOUT')
  ) {
    await paymentService.markSuccess(pt._id, {
      verificationMethod: 'RECON_SWEEP',
      gatewayTxnId: row.gatewayTxnId,
      gatewayResponsePayload: row.rawRow,
    });
    pt.reconciledAt = new Date();
    if (row.settlementUtr) {
      pt.settlement = {
        ...(pt.settlement ?? {}),
        settlementUtr: row.settlementUtr,
        settlementAmount: row.amount - (row.mdrAmount ?? 0) - (row.gstOnMdr ?? 0),
        mdrAmount: row.mdrAmount ?? null,
        gstOnMdr: row.gstOnMdr ?? null,
        settledAt: new Date(),
      };
    }
    await pt.save();
    report.resolvedCount++;
    report.discrepancies.push({
      kind: 'OK_RESOLVED_FROM_PENDING',
      gatewayTxnId: row.gatewayTxnId,
      paymentTxnCode: pt.txnCode,
      detail: `recovered: PT was ${pt.status}, gateway says SUCCESS — wallet credited`,
    });
    report.matchedCount++;
    return;
  }

  // Status mismatch the other way: we say SUCCESS, gateway says FAILED. Loud.
  if (pt.status === 'SUCCESS' && row.status !== 'SUCCESS') {
    report.discrepancies.push({
      kind: 'STATUS_MISMATCH',
      gatewayTxnId: row.gatewayTxnId,
      paymentTxnCode: pt.txnCode,
      ourStatus: pt.status,
      gatewayStatus: row.status,
      detail: 'we credited the wallet but gateway says non-success — manual review',
    });
    report.discrepancyCount++;
    return;
  }

  // Happy path: both agree.
  pt.reconciledAt = new Date();
  if (row.settlementUtr && pt.settlement?.settlementUtr !== row.settlementUtr) {
    pt.settlement = {
      ...(pt.settlement ?? {}),
      settlementUtr: row.settlementUtr,
      settlementAmount: row.amount - (row.mdrAmount ?? 0) - (row.gstOnMdr ?? 0),
      mdrAmount: row.mdrAmount ?? null,
      gstOnMdr: row.gstOnMdr ?? null,
      settledAt: new Date(),
    };
  }
  await pt.save();
  report.matchedCount++;
}

async function emailFinanceTeam(report: ReconciliationReport): Promise<void> {
  // Real email send happens via existing notification service; for now we
  // just log a structured warning that ops can grep for.
  logger.warn(
    {
      action: 'finance-alert',
      batchId: report.batchId,
      discrepancyCount: report.discrepancyCount,
      sampleDiscrepancies: report.discrepancies.slice(0, 5),
    },
    'TODO-FINANCE-EMAIL: reconciliation discrepancies — wire to notification service',
  );
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function nextDay(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}
