// Phase-15 — balance-reader tests.
//
// Verifies the read-side cutover from Agency.walletBalance to Wallet.balance:
//   • Wallet present → Wallet.balance is authoritative (even when it differs
//     from the legacy Agency.walletBalance field — that's the whole point)
//   • Wallet absent → Agency.walletBalance is the fallback
//   • Neither → 0
//   • Batch round-trip avoids N+1: single Wallet.find covers everyone, only
//     missing IDs fall back to Agency
//   • Empty input → empty Map, no Mongo round-trip wasted

import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { Tenant } from '../src/models/Tenant.js';
import { Agency } from '../src/models/Agency.js';
import { Wallet } from '../src/models/Wallet.js';
import {
  readAgencyBalance,
  readAgencyBalances,
} from '../src/services/wallet/balance-reader.js';

let tenantId: Types.ObjectId;

async function makeAgency(
  legacyWalletBalance: number,
  walletBalance: number | null,
): Promise<Types.ObjectId> {
  const agencyId = new Types.ObjectId();
  await Agency.create({
    _id: agencyId,
    tenantId,
    agencyCode: `BR-${crypto.randomBytes(4).toString('hex')}`,
    companyName: 'Balance Reader Test',
    state: 'MH',
    city: 'Mumbai',
    pincode: '400001',
    address: 'x',
    module: 'CASH',
    walletBalance: legacyWalletBalance,
    status: 'ACTIVE',
    ownerUserId: new Types.ObjectId(),
  });
  if (walletBalance !== null) {
    await Wallet.create({
      tenantId,
      agencyId,
      walletCode: `WAL-BR-${crypto.randomBytes(4).toString('hex')}`,
      balance: walletBalance,
      version: 0,
    });
  }
  return agencyId;
}

beforeAll(async () => {
  await connectMongo();
  const t = await Tenant.create({
    code: `br-${crypto.randomBytes(4).toString('hex')}`,
    name: 'Balance Reader Test',
    domain: 'br.test',
  });
  tenantId = t._id;
});

afterAll(async () => {
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
  await Tenant.deleteOne({ _id: tenantId });
  await disconnectMongo();
});

beforeEach(async () => {
  await Wallet.deleteMany({ tenantId });
  await Agency.deleteMany({ tenantId });
});

describe('readAgencyBalance (single)', () => {
  it('returns Wallet.balance when a Wallet row exists', async () => {
    // Drift between the two intentionally: even when Agency.walletBalance
    // hasn't caught up, Wallet wins.
    const agencyId = await makeAgency(123, 999_999);
    const balance = await readAgencyBalance(agencyId);
    expect(balance).toBe(999_999);
  });

  it('falls back to Agency.walletBalance when no Wallet row exists', async () => {
    const agencyId = await makeAgency(42_000, null);
    const balance = await readAgencyBalance(agencyId);
    expect(balance).toBe(42_000);
  });

  it('returns 0 when neither Wallet nor Agency has a balance', async () => {
    const agencyId = await makeAgency(0, null);
    // Wipe the legacy field too.
    await Agency.updateOne({ _id: agencyId }, { $unset: { walletBalance: 1 } });
    const balance = await readAgencyBalance(agencyId);
    expect(balance).toBe(0);
  });

  it('accepts a string ObjectId argument', async () => {
    const agencyId = await makeAgency(0, 500_000);
    const balance = await readAgencyBalance(String(agencyId));
    expect(balance).toBe(500_000);
  });
});

describe('readAgencyBalances (batch)', () => {
  it('returns a Map keyed by string agencyId, sourced from Wallet first', async () => {
    const a1 = await makeAgency(100, 200_000);
    const a2 = await makeAgency(200, 300_000);
    const map = await readAgencyBalances([a1, a2]);
    expect(map.size).toBe(2);
    expect(map.get(String(a1))).toBe(200_000);
    expect(map.get(String(a2))).toBe(300_000);
  });

  it('mixes Wallet hits + Agency fallback in one call', async () => {
    const hasWallet = await makeAgency(0, 700_000);
    const legacyOnly = await makeAgency(50_000, null); // no Wallet
    const map = await readAgencyBalances([hasWallet, legacyOnly]);
    expect(map.get(String(hasWallet))).toBe(700_000);
    expect(map.get(String(legacyOnly))).toBe(50_000);
  });

  it('empty input returns an empty Map with no Mongo round-trip', async () => {
    const map = await readAgencyBalances([]);
    expect(map.size).toBe(0);
  });

  it('returns 0 for agencies in the input that do not exist (cleared field)', async () => {
    const a = await makeAgency(0, null);
    await Agency.updateOne({ _id: a }, { $unset: { walletBalance: 1 } });
    const map = await readAgencyBalances([a]);
    expect(map.get(String(a))).toBe(0);
  });
});
