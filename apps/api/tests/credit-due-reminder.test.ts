// Phase-8 tests for the credit-due reminder service.
//
// Covers:
//   - pickAnchorOffset (pure) — landing on T-3 / T-1 / T+0 / T+3, ignoring
//     non-anchor days, ignoring intra-day clock drift.
//   - runCreditDueReminders integration — fires on the right anchor,
//     skips zero-credit-used agencies, dedupes within 24 h.

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import { redis } from '../src/config/redis.js';
import {
  pickAnchorOffset,
  runCreditDueReminders,
} from '../src/services/wallet/credit-due-reminder.service.js';

let tenantId: Types.ObjectId;

async function makeAgency(opts: {
  creditDueDate?: Date | null;
  creditUsed?: number;
  module?: 'CREDIT' | 'CASH';
}): Promise<Types.ObjectId> {
  const id = new Types.ObjectId();
  await Agency.create({
    _id: id,
    tenantId,
    agencyCode: `DR-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Reminder Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: opts.module ?? 'CREDIT',
    creditDueDate: opts.creditDueDate ?? null,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  await Wallet.create({
    tenantId,
    agencyId: id,
    walletCode: `WAL-DR-${crypto.randomBytes(4).toString('hex')}`,
    balance: 0,
    creditUsed: opts.creditUsed ?? 0,
    version: 0,
  });
  return id;
}

// Build a Date for a deterministic local-midnight day, useful so the
// floor-to-day logic in pickAnchorOffset matches the test's expectation.
function dayUtc(offsetDaysFromToday: number, base: Date = new Date()): Date {
  const baseDay = Math.floor(base.getTime() / 86_400_000);
  return new Date((baseDay + offsetDaysFromToday) * 86_400_000);
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `dr-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Credit Due Reminder',
    domain: 'dr.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  // Clean up dedupe keys we set during the run.
  const stream = redis.scanStream({ match: 'credit-due:fired:*', count: 200 });
  const keys: string[] = [];
  for await (const batch of stream) keys.push(...(batch as string[]));
  if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  await disconnectMongo();
});

beforeEach(async () => {
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  // Per-test dedupe cleanup — keeps Redis fresh between scenarios.
  const stream = redis.scanStream({ match: 'credit-due:fired:*', count: 200 });
  const keys: string[] = [];
  for await (const batch of stream) keys.push(...(batch as string[]));
  if (keys.length > 0) await redis.del(...keys);
});

describe('pickAnchorOffset — pure', () => {
  const today = new Date('2026-06-15T10:00:00.000Z');

  it('hits T-3 anchor when due is 3 days in the future', () => {
    const due = new Date('2026-06-18T00:00:00.000Z');
    expect(pickAnchorOffset(due, today)).toBe(-3);
  });

  it('hits T-1 anchor', () => {
    const due = new Date('2026-06-16T00:00:00.000Z');
    expect(pickAnchorOffset(due, today)).toBe(-1);
  });

  it('hits T+0 anchor on the due date itself', () => {
    const due = new Date('2026-06-15T23:00:00.000Z');
    expect(pickAnchorOffset(due, today)).toBe(0);
  });

  it('hits T+3 anchor when 3 days overdue', () => {
    const due = new Date('2026-06-12T05:00:00.000Z');
    expect(pickAnchorOffset(due, today)).toBe(3);
  });

  it('returns null for non-anchor days', () => {
    const t2 = new Date('2026-06-17T00:00:00.000Z'); // 2 days before
    const t5 = new Date('2026-06-10T00:00:00.000Z'); // 5 days overdue
    expect(pickAnchorOffset(t2, today)).toBeNull();
    expect(pickAnchorOffset(t5, today)).toBeNull();
  });

  it('intra-day clock drift does NOT shift the anchor', () => {
    const due = new Date('2026-06-18T23:00:00.000Z');
    const morning = new Date('2026-06-15T02:00:00.000Z');
    const evening = new Date('2026-06-15T22:00:00.000Z');
    expect(pickAnchorOffset(due, morning)).toBe(-3);
    expect(pickAnchorOffset(due, evening)).toBe(-3);
  });
});

describe('runCreditDueReminders — integration', () => {
  it('fires on T-3 when agency owes credit and due is 3 days out', async () => {
    const due = dayUtc(3); // due in 3 days
    await makeAgency({ creditDueDate: due, creditUsed: 50_000 });
    const r = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(r.scannedAgencies).toBe(1);
    expect(r.firedReminders).toBe(1);
  });

  it('skips agency with zero outstanding credit', async () => {
    const due = dayUtc(3);
    await makeAgency({ creditDueDate: due, creditUsed: 0 });
    const r = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(r.firedReminders).toBe(0);
  });

  it('skips non-anchor days', async () => {
    const due = dayUtc(5); // 5 days out — no anchor matches
    await makeAgency({ creditDueDate: due, creditUsed: 50_000 });
    const r = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(r.firedReminders).toBe(0);
  });

  it('only scans CREDIT-module agencies', async () => {
    const due = dayUtc(0);
    await makeAgency({ creditDueDate: due, creditUsed: 50_000, module: 'CASH' });
    const r = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(r.scannedAgencies).toBe(0);
  });

  it('dedupes within 24h on the same anchor', async () => {
    const due = dayUtc(0);
    await makeAgency({ creditDueDate: due, creditUsed: 50_000 });

    const first = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(first.firedReminders).toBe(1);

    const second = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(second.firedReminders).toBe(0);
    expect(second.skippedDeduped).toBe(1);
  });

  it('fires fresh on a different anchor (T+0 → T+3)', async () => {
    // Agency lands on T+0 today; tomorrow the clock has moved but the anchor
    // index for THIS run is determined by the runtime "now". We exercise the
    // anchor change by giving the service an explicit `now` advancement.
    const due = dayUtc(0);
    await makeAgency({ creditDueDate: due, creditUsed: 50_000 });

    // First run lands T+0.
    const t0 = await runCreditDueReminders({ tenantId: String(tenantId) });
    expect(t0.firedReminders).toBe(1);

    // Three days later — same agency, but now we're on the T+3 anchor. A
    // different dedupe key (offset:3 vs offset:0) so the alert fires again.
    const threeDaysLater = new Date(Date.now() + 3 * 86_400_000);
    const t3 = await runCreditDueReminders({
      tenantId: String(tenantId),
      now: threeDaysLater,
    });
    expect(t3.firedReminders).toBe(1);
  });
});
