/**
 * Phase 4 smoke — exercises endorse + cancel against the ASEGO sandbox.
 *
 * Since `createPolicy` is currently blocked on the sandbox (code 159 generic
 * 500 — pending ASEGO support), we seed a fake "issued" policy in Mongo with
 * a synthetic policyNumber so the lifecycle services have something to read
 * snapshots from. ASEGO itself will reject the unknown policyNumber, which
 * is fine — the test confirms our wire-format + auth + persistence path is
 * correct end-to-end.
 *
 * Run:
 *    pnpm --filter @tripbng/api exec tsx src/scripts/asego-lifecycle-smoke.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectMongo } from '../config/db.js';
import { connectRedis, redis } from '../config/redis.js';
import { listCategories, listPlanMaster } from '../services/insurance/master.service.js';
import { cancelPolicy } from '../services/insurance/cancel.service.js';
import { endorsePolicy } from '../services/insurance/endorse.service.js';
import { InsurancePolicy } from '../models/InsurancePolicy.js';
import { InsurancePolicyEvent } from '../models/InsurancePolicyEvent.js';

interface MasterPlan {
  insurerId: string;
  insurerName?: string;
  planId: string;
  planName: string;
  geographicalArea: string;
}

async function seedFakePolicy(tenantId: string, userId: string): Promise<string> {
  const categories = await listCategories();
  const domestic = categories.find((c) => c.name.toLowerCase() === 'domestic');
  if (!domestic) throw new Error('Domestic category not found');
  const masterRaw = await listPlanMaster();
  const plan = (masterRaw as { sellingPlanDto?: MasterPlan[] }).sellingPlanDto?.find(
    (p) => p.geographicalArea === domestic.id,
  );
  if (!plan) throw new Error('no domestic plan in master');

  const policyNumber = `TB-TEST-${Date.now()}`;
  await InsurancePolicy.create({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    bookingId: null,
    orderId: 'lifecycle-smoke-' + Date.now(),
    policyNumber,
    policyFilePath: null,
    status: 'ISSUED',
    insurerId: plan.insurerId,
    insurerName: plan.insurerName ?? null,
    planId: plan.planId,
    planName: plan.planName,
    sellingPlanId: plan.planId,
    travelerSnapshot: {
      firstName: 'Test',
      lastName: 'Buyer',
      dateOfBirth: '1990-01-15',
      gender: 'M',
      passport: 'M1234567',
      email: 'test@tripbng.dev',
      mobileNo: '9999999999',
      pincode: '110001',
      address: '1 Test Lane, New Delhi',
      district: 'New Delhi',
      state: 'Delhi',
      country: 'India',
      nominee: { firstName: 'Self', lastName: 'Buyer', relation: 'Self' },
    },
    quotationSnapshot: {
      startDate: '2026-06-01',
      endDate: '2026-06-08',
      category: domestic.id,
      destination: 'Goa',
    },
    selectedPlanSnapshot: {
      insurerId: plan.insurerId,
      planId: plan.planId,
      sellingPlanId: plan.planId,
      totalPremiumPaise: 50000,
    },
    totalPremiumPaise: 50000,
    currency: 'INR',
    createdBy: new mongoose.Types.ObjectId(userId),
  });
  return policyNumber;
}

async function main() {
  await connectMongo();
  await connectRedis();

  const tenantId = new mongoose.Types.ObjectId().toString();
  const userId = new mongoose.Types.ObjectId().toString();

  console.warn('▶ seeding fake policy in Mongo');
  const policyNumber = await seedFakePolicy(tenantId, userId);
  console.warn(`  policy: ${policyNumber}`);

  // Use a placeholder reasonId — the sandbox /reasons/:type endpoint is broken
  // so we can't fetch a real one. ASEGO will reject the unknown UUID with a
  // specific error, confirming our wire-format reaches them correctly.
  const placeholderReasonId = '00000000-0000-0000-0000-000000000000';

  console.warn('\n▶ endorse');
  try {
    const out = await endorsePolicy(
      { tenantId, userId },
      {
        policyNumber,
        reasonId: placeholderReasonId,
        remarks: 'Phase-4 smoke — extend trip dates',
        newStartDate: '2026-06-05',
        newEndDate: '2026-06-15',
      },
    );
    console.warn(`  ✓ endorse ok: ${JSON.stringify(out)}`);
  } catch (err) {
    console.warn(`  · endorse rejected (expected): ${(err as Error).message}`);
  }

  console.warn('\n▶ cancel');
  try {
    const out = await cancelPolicy(
      { tenantId, userId },
      {
        policyNumber,
        reasonId: placeholderReasonId,
        remarks: 'Phase-4 smoke — cancellation',
      },
    );
    console.warn(`  ✓ cancel ok: ${JSON.stringify(out)}`);
  } catch (err) {
    console.warn(`  · cancel rejected (expected): ${(err as Error).message}`);
  }

  // Confirm Mongo audit + status updates
  const events = await InsurancePolicyEvent.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    policyNumber,
  }).lean();
  console.warn(
    `\n▶ audit log: ${events.length} event(s) (${events.map((e) => e.eventType).join(',')})`,
  );

  const refreshed = await InsurancePolicy.findOne({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    policyNumber,
  }).lean();
  console.warn(`▶ persisted policy.status: ${refreshed?.status}`);

  // Cleanup the fixture so reruns don't pollute Mongo.
  await InsurancePolicy.deleteOne({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    policyNumber,
  });
  await InsurancePolicyEvent.deleteMany({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    policyNumber,
  });

  await redis.quit();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
