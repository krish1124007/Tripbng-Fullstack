// Migration: rename providerCode `ICICI_EAZYPAY` -> `ICICI_ORANGE_PG`
// across PaymentTransaction, PaymentGatewayConfig, and WebhookEvent.
//
// Context: ICICI Eazypay is being retired in favour of ICICI Orange PG
// (Pay Gateway / TSP). The new provider replaces the old slot — the
// rename keeps the historical record intact while the rest of the
// codebase migrates to the new identifier.
//
// Safety:
//   - Idempotent — re-running is a no-op (filter on legacy value).
//   - Bulk write per collection, logs counts at each step.
//   - Read-only dry run is the default. Pass `--apply` to actually write.
//
// Usage:
//   pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-rename-icici-eazypay-to-orange-pg.ts
//   pnpm -F @tripbng/api tsx scripts/migrations/2026-05-20-rename-icici-eazypay-to-orange-pg.ts --apply

import mongoose from 'mongoose';
import { env } from '../../src/config/env.js';
import { logger } from '../../src/config/logger.js';
import { PaymentTransaction } from '../../src/models/PaymentTransaction.js';
import { PaymentGatewayConfig } from '../../src/models/PaymentGatewayConfig.js';
import { WebhookEvent } from '../../src/models/WebhookEvent.js';
import { CreditSettlement } from '../../src/models/CreditSettlement.js';

const LEGACY = 'ICICI_EAZYPAY';
const TARGET = 'ICICI_ORANGE_PG';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGO_URI);
  logger.info({ apply }, 'migration start');

  const ptFilter = { providerCode: LEGACY };
  const pgcFilter = { providerCode: LEGACY };
  const wePerFilter = { providerCode: LEGACY };
  // CreditSettlement uses a different field (`pgGateway`) and tracks both
  // legacy gateway slots (ICICI_EAZYPAY + RAZORPAY). The waterfall service
  // isn't wired into prod yet so there should be zero rows; the script
  // updates anyway to keep dev/staging DBs consistent.
  const csIciciFilter = { pgGateway: LEGACY };
  const csRzpFilter = { pgGateway: 'RAZORPAY' };

  const [ptCount, pgcCount, weCount, csIciciCount, csRzpCount] = await Promise.all([
    PaymentTransaction.countDocuments(ptFilter),
    PaymentGatewayConfig.countDocuments(pgcFilter),
    WebhookEvent.countDocuments(wePerFilter),
    CreditSettlement.countDocuments(csIciciFilter),
    CreditSettlement.countDocuments(csRzpFilter),
  ]);

  logger.info(
    { ptCount, pgcCount, weCount, csIciciCount, csRzpCount },
    `rows to migrate ${LEGACY} -> ${TARGET} (plus CreditSettlement RAZORPAY -> MANUAL)`,
  );

  if (!apply) {
    logger.warn('dry run — pass --apply to write changes');
    await mongoose.disconnect();
    return;
  }

  const [ptRes, pgcRes, weRes, csIciciRes, csRzpRes] = await Promise.all([
    PaymentTransaction.updateMany(ptFilter, { $set: { providerCode: TARGET } }),
    PaymentGatewayConfig.updateMany(pgcFilter, { $set: { providerCode: TARGET } }),
    WebhookEvent.updateMany(wePerFilter, { $set: { providerCode: TARGET } }),
    CreditSettlement.updateMany(csIciciFilter, { $set: { pgGateway: TARGET } }),
    // Razorpay is fully retired — no successor gateway in waterfall code.
    // Map legacy rows to MANUAL so the enum stays satisfied; audit trail
    // preserves the original via the WalletTransaction.pgReferenceId join.
    CreditSettlement.updateMany(csRzpFilter, { $set: { pgGateway: 'MANUAL' } }),
  ]);

  logger.info(
    {
      paymentTransaction: { matched: ptRes.matchedCount, modified: ptRes.modifiedCount },
      paymentGatewayConfig: { matched: pgcRes.matchedCount, modified: pgcRes.modifiedCount },
      webhookEvent: { matched: weRes.matchedCount, modified: weRes.modifiedCount },
      creditSettlementIcici: { matched: csIciciRes.matchedCount, modified: csIciciRes.modifiedCount },
      creditSettlementRzp: { matched: csRzpRes.matchedCount, modified: csRzpRes.modifiedCount },
    },
    'migration complete',
  );

  await mongoose.disconnect();
}

void main().catch((err) => {
  logger.error({ err }, 'migration failed');
  process.exitCode = 1;
});
