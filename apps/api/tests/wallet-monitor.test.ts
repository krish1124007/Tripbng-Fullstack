// Wallet-monitor worker tests.
//
// Mocks Wallet + Agency models, redis, and enqueueAlert so the worker
// can run without a database. Coverage:
//   - Critical-tier alert fires every tick (no dedupe)
//   - Low-tier alert fires once, second tick deduped via Redis SETNX
//   - Agency-without-owner is skipped without throwing
//   - Wallets above threshold are not scanned (the Mongo query already
//     filters; we assert that even when the worker iterates an empty
//     result, it logs cleanly and moves on)

import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Redis stand-in. SETNX returns 'OK' only when the key
// didn't exist — matches ioredis's behaviour.
const memStore = new Map<string, { value: string; expiresAt: number }>();
vi.mock('../src/config/redis.js', () => {
  const fakeRedis = {
    set: vi.fn(async (key: string, value: string, _mode: string, ttlSec: number, nxFlag?: string) => {
      const existing = memStore.get(key);
      if (nxFlag === 'NX' && existing && Date.now() < existing.expiresAt) {
        return null;
      }
      memStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      return 'OK';
    }),
    get: vi.fn(async (key: string) => {
      const row = memStore.get(key);
      if (!row || Date.now() > row.expiresAt) return null;
      return row.value;
    }),
    del: vi.fn(async (key: string) => {
      memStore.delete(key);
      return 1;
    }),
  };
  return { redis: fakeRedis, bullmqRedis: fakeRedis };
});

// Stub Wallet + Agency models so the worker doesn't need a Mongo
// connection. We expose the Wallet.find query builder as a thenable.
let walletRows: Array<{
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  agencyId: Types.ObjectId;
  balance: number;
}> = [];
const findCallArgs: { filter?: unknown }[] = [];

vi.mock('../src/models/Wallet.js', () => ({
  Wallet: {
    find: vi.fn((filter: unknown) => {
      findCallArgs.push({ filter });
      return {
        select: () => ({
          lean: async () => walletRows,
        }),
      };
    }),
  },
}));

let agencyRow: { _id: Types.ObjectId; ownerUserId: Types.ObjectId | null } | null = null;
vi.mock('../src/models/Agency.js', () => ({
  Agency: {
    findById: vi.fn((_id: Types.ObjectId) => ({
      select: () => ({
        lean: async () => agencyRow,
      }),
    })),
  },
}));

// Capture every enqueueAlert call so assertions can introspect.
const alertCalls: Array<{
  payload: { event: string; vars: Record<string, unknown> };
  recipients: unknown[];
  opts: Record<string, unknown>;
}> = [];
vi.mock('../src/services/alerts/index.js', () => ({
  enqueueAlert: vi.fn(
    async (payload: { event: string; vars: Record<string, unknown> }, recipients: unknown[], opts: Record<string, unknown>) => {
      alertCalls.push({ payload, recipients, opts });
    },
  ),
}));

import { walletMonitorProcessor } from '../src/queues/wallet-monitor.worker.js';
import { env } from '../src/config/env.js';

beforeEach(() => {
  memStore.clear();
  walletRows = [];
  alertCalls.length = 0;
  findCallArgs.length = 0;
  agencyRow = {
    _id: new Types.ObjectId(),
    ownerUserId: new Types.ObjectId(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

const runTick = async (): Promise<void> => {
  await walletMonitorProcessor({ data: { triggeredBy: 'cron' } } as never);
};

describe('walletMonitorProcessor — critical tier', () => {
  it('fires CRITICAL alert when balance is below the critical threshold', async () => {
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        // Below CRITICAL_WALLET_THRESHOLD_PAISE default (20_000).
        balance: 5_000,
      },
    ];
    await runTick();
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0]!.payload.event).toBe('LOW_WALLET_BALANCE');
    expect(alertCalls[0]!.payload.vars.severity).toBe('critical');
    expect(alertCalls[0]!.payload.vars.thresholdPaise).toBe(env.CRITICAL_WALLET_THRESHOLD_PAISE);
  });

  it('CRITICAL fires every tick (no dedupe)', async () => {
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        balance: 5_000,
      },
    ];
    await runTick();
    await runTick();
    await runTick();
    expect(alertCalls).toHaveLength(3);
    expect(alertCalls.every((c) => c.payload.vars.severity === 'critical')).toBe(true);
  });
});

describe('walletMonitorProcessor — low tier', () => {
  it('fires LOW alert when balance is between critical and low thresholds', async () => {
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        // Between CRITICAL (20_000) and LOW (100_000).
        balance: 50_000,
      },
    ];
    await runTick();
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0]!.payload.vars.severity).toBe('low');
    expect(alertCalls[0]!.payload.vars.thresholdPaise).toBe(env.LOW_WALLET_THRESHOLD_PAISE);
  });

  it('LOW dedupes on the second tick (Redis SETNX claims the slot)', async () => {
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        balance: 50_000,
      },
    ];
    await runTick();
    await runTick();
    expect(alertCalls).toHaveLength(1);
  });
});

describe('walletMonitorProcessor — recipient resolution', () => {
  it('skips alert when agency row is missing', async () => {
    agencyRow = null;
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        balance: 5_000,
      },
    ];
    await runTick();
    expect(alertCalls).toHaveLength(0);
  });

  it('skips alert when agency has no ownerUserId', async () => {
    agencyRow = {
      _id: new Types.ObjectId(),
      ownerUserId: null,
    };
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        balance: 5_000,
      },
    ];
    await runTick();
    expect(alertCalls).toHaveLength(0);
  });

  it('alert recipient is the agency owner', async () => {
    const ownerId = new Types.ObjectId();
    agencyRow = { _id: new Types.ObjectId(), ownerUserId: ownerId };
    walletRows = [
      {
        _id: new Types.ObjectId(),
        tenantId: new Types.ObjectId(),
        agencyId: new Types.ObjectId(),
        balance: 5_000,
      },
    ];
    await runTick();
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0]!.recipients).toEqual([
      { kind: 'user', id: String(ownerId) },
    ]);
  });
});

describe('walletMonitorProcessor — empty result', () => {
  it('logs cleanly and emits no alerts when no wallets are low', async () => {
    walletRows = [];
    await runTick();
    expect(alertCalls).toHaveLength(0);
  });
});

describe('walletMonitorProcessor — Mongo query shape', () => {
  it('queries ACTIVE agency-owned wallets with balance below low threshold', async () => {
    walletRows = [];
    await runTick();
    expect(findCallArgs).toHaveLength(1);
    const filter = findCallArgs[0]!.filter as Record<string, unknown>;
    expect(filter.status).toBe('ACTIVE');
    expect(filter.lowBalanceAlertEnabled).toBe(true);
    expect(filter.balance).toEqual({ $lt: env.LOW_WALLET_THRESHOLD_PAISE });
    expect(filter.agencyId).toEqual({ $ne: null });
  });
});
