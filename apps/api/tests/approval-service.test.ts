// ApprovalRequest service integration tests.
//
// Boots a real Mongo (test DB) so the state machine + indexes are
// exercised exactly as production. Mirrors the pattern in
// booking.test.ts.
//
// Coverage:
//   - submit happy path → pending or auto-approved
//   - approve / reject state transitions
//   - rejection note guard (< 10 chars rejected)
//   - manager-vs-actor authorisation
//   - state guards (terminal states never re-decide)
//   - sweep-expired moves stale `pending` → `expired`
//   - markApprovalBooked: approved → booked

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { ApprovalRequest } from '../src/models/ApprovalRequest.js';
import { Employee } from '../src/models/Employee.js';
import { TravelPolicy } from '../src/models/TravelPolicy.js';
import {
  approveApproval,
  markApprovalBooked,
  rejectApproval,
  submitBusApproval,
  sweepExpiredApprovals,
  type ApprovalActor,
} from '../src/services/approval/approval.service.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_approval';

let tenantId: string;
let employeeId: string;
let managerId: string;
let actorUserId: string;

async function reset(): Promise<void> {
  await Promise.all([
    ApprovalRequest.deleteMany({}),
    Employee.deleteMany({}),
    TravelPolicy.deleteMany({}),
  ]);

  tenantId = new Types.ObjectId().toString();
  managerId = new Types.ObjectId().toString();
  actorUserId = new Types.ObjectId().toString();

  const employee = await Employee.create({
    tenantId,
    agencyId: new Types.ObjectId(),
    empCode: 'EMP-001',
    name: 'Test Employee',
    email: 'test.employee@acme.dev',
    mobile: '+919999999999',
    gender: 'FEMALE',
    managerId,
    status: 'ACTIVE',
  });
  employeeId = String(employee._id);
}

const baseSubmit = () => ({
  employeeId,
  sourceCityId: 122,
  destinationCityId: 124,
  doj: '2026-08-15',
  tripId: 'TRIP-A',
  inventoryId: 'INV-A',
  seatNumbers: ['L1'],
  boardingPointId: 1001,
  droppingPointId: 2001,
  estimatedFarePaise: 100_000,
  operatorName: 'TripBNG Test',
  operatorId: 9001,
  busType: 'AC Sleeper',
  busTypeId: 17,
  isAc: true,
  isSleeper: true,
  // 30 days out from now, well within booking-window guards.
  departureAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  arrivalAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString(),
});

const employeeActor = (): ApprovalActor => ({
  tenantId,
  userId: actorUserId,
  role: 'AGENCY',
  ipAddress: '127.0.0.1',
});

const managerActor = (): ApprovalActor => ({
  tenantId,
  userId: managerId,
  role: 'AGENCY',
  ipAddress: '127.0.0.1',
});

// AppError surfaces the human-readable cause via `.details.reason` while
// .message stays as the canned "Invalid input". The reasonOf helper pulls
// whichever is set so test matchers can target the specific cause.
const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    throw new Error('expected rejection');
  } catch (err) {
    return (
      (err as { details?: { reason?: string }; message?: string }).details?.reason
      ?? (err as Error).message
      ?? ''
    );
  }
};

beforeAll(async () => {
  await connectMongo();
});

afterAll(async () => {
  await disconnectMongo();
});

beforeEach(async () => {
  await reset();
});

describe('submitBusApproval', () => {
  it('creates a pending request when no policy is wired', async () => {
    const result = await submitBusApproval(employeeActor(), baseSubmit());
    expect(result.approval.status).toBe('pending');
    expect(result.approval.policyViolations).toEqual([]);
    expect(result.policy.ok).toBe(true);
    expect(result.policy.requiresApproval).toBe(false);
    expect(result.approval.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('auto-approves when fare ≤ autoApproveBelowPaise + no fare-band requirement', async () => {
    const policy = await TravelPolicy.create({
      tenantId,
      name: 'permissive-low',
      autoApproveBelowPaise: 200_000,
      rules: { bus: { maxFarePaise: 500_000 } },
    });
    await Employee.updateOne(
      { _id: employeeId },
      { $set: { travelPolicyId: policy._id } },
    );

    const result = await submitBusApproval(employeeActor(), baseSubmit());
    expect(result.approval.status).toBe('approved');
    expect(result.approval.decidedAt).not.toBeNull();
    expect(result.policy.autoApproveEligible).toBe(true);
  });

  it('keeps pending when fare > requireApprovalAbovePaise even if auto-eligible', async () => {
    const policy = await TravelPolicy.create({
      tenantId,
      name: 'fare-band',
      autoApproveBelowPaise: 500_000, // would auto-approve
      rules: { bus: { requireApprovalAbovePaise: 50_000 } }, // but this kicks in
    });
    await Employee.updateOne(
      { _id: employeeId },
      { $set: { travelPolicyId: policy._id } },
    );
    const result = await submitBusApproval(employeeActor(), baseSubmit());
    expect(result.approval.status).toBe('pending');
    expect(result.policy.requiresApproval).toBe(true);
    expect(result.policy.autoApproveEligible).toBe(true);
  });

  it('records policy violations on out-of-policy submissions', async () => {
    const policy = await TravelPolicy.create({
      tenantId,
      name: 'strict',
      rules: { bus: { acOnly: true } },
    });
    await Employee.updateOne(
      { _id: employeeId },
      { $set: { travelPolicyId: policy._id } },
    );
    const result = await submitBusApproval(
      employeeActor(),
      { ...baseSubmit(), isAc: false },
    );
    expect(result.policy.ok).toBe(false);
    expect(result.approval.policyViolations.length).toBeGreaterThan(0);
    // Out-of-policy still creates a pending request — manager can override.
    expect(result.approval.status).toBe('pending');
  });

  it('rejects a request with no seats', async () => {
    await expect(
      submitBusApproval(employeeActor(), { ...baseSubmit(), seatNumbers: [] }),
    ).rejects.toThrow();
  });

  it('rejects when employee belongs to another tenant', async () => {
    const otherTenantId = new Types.ObjectId().toString();
    const actor: ApprovalActor = {
      tenantId: otherTenantId,
      userId: actorUserId,
      role: 'AGENCY',
    };
    await expect(submitBusApproval(actor, baseSubmit())).rejects.toThrow();
  });

  it('snapshots estimatedTotalPaise = farePerSeat × seatCount', async () => {
    const result = await submitBusApproval(employeeActor(), {
      ...baseSubmit(),
      seatNumbers: ['L1', 'L2', 'L3'],
      estimatedFarePaise: 75_000,
    });
    expect(result.approval.payload.estimatedTotalPaise).toBe(225_000);
  });
});

describe('approveApproval', () => {
  it('transitions pending → approved when called by the manager', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    const decided = await approveApproval(
      managerActor(),
      String(submitted.approval._id),
      'Looks good',
    );
    expect(decided.status).toBe('approved');
    expect(decided.approverNote).toBe('Looks good');
    expect(decided.decidedByUserId?.toString()).toBe(managerId);
  });

  it('allows SUPER_ADMIN to approve regardless of manager assignment', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    const adminActor: ApprovalActor = {
      tenantId,
      userId: new Types.ObjectId().toString(),
      role: 'SUPER_ADMIN',
    };
    const decided = await approveApproval(adminActor, String(submitted.approval._id), undefined);
    expect(decided.status).toBe('approved');
  });

  it('rejects when actor is neither manager nor privileged', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    const stranger: ApprovalActor = {
      tenantId,
      userId: new Types.ObjectId().toString(),
      role: 'AGENCY',
    };
    await expect(
      approveApproval(stranger, String(submitted.approval._id), undefined),
    ).rejects.toThrow();
  });

  it('refuses to re-approve a terminal request', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await approveApproval(managerActor(), String(submitted.approval._id), undefined);
    expect(
      await reasonOf(
        approveApproval(managerActor(), String(submitted.approval._id), undefined),
      ),
    ).toMatch(/cannot transition approved/);
  });
});

describe('rejectApproval', () => {
  it('transitions pending → rejected with a long-enough note', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    const decided = await rejectApproval(
      managerActor(),
      String(submitted.approval._id),
      'Out of budget for this quarter',
    );
    expect(decided.status).toBe('rejected');
    expect(decided.approverNote).toContain('Out of budget');
  });

  it('rejects rejection with a note shorter than 10 chars', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    expect(
      await reasonOf(
        rejectApproval(managerActor(), String(submitted.approval._id), 'short'),
      ),
    ).toMatch(/≥ 10 characters/);
  });

  it('rejects rejection with no note at all', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    expect(
      await reasonOf(
        rejectApproval(managerActor(), String(submitted.approval._id), ''),
      ),
    ).toMatch(/≥ 10 characters/);
  });
});

describe('sweepExpiredApprovals', () => {
  it('marks pending requests past expiresAt as expired', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    // Force-expire by rewriting the field — service writes future
    // dates so we manipulate to simulate the passage of time.
    await ApprovalRequest.updateOne(
      { _id: submitted.approval._id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const count = await sweepExpiredApprovals();
    expect(count).toBe(1);
    const refetched = await ApprovalRequest.findById(submitted.approval._id);
    expect(refetched?.status).toBe('expired');
  });

  it('leaves non-pending requests untouched', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await approveApproval(managerActor(), String(submitted.approval._id), undefined);
    await ApprovalRequest.updateOne(
      { _id: submitted.approval._id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const count = await sweepExpiredApprovals();
    expect(count).toBe(0);
    const refetched = await ApprovalRequest.findById(submitted.approval._id);
    expect(refetched?.status).toBe('approved');
  });

  it('is idempotent — second sweep on a fresh tick touches nothing new', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await ApprovalRequest.updateOne(
      { _id: submitted.approval._id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    expect(await sweepExpiredApprovals()).toBe(1);
    expect(await sweepExpiredApprovals()).toBe(0);
  });
});

describe('markApprovalBooked', () => {
  it('transitions approved → booked', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await approveApproval(managerActor(), String(submitted.approval._id), undefined);
    const bookingId = new Types.ObjectId();
    const booked = await markApprovalBooked(submitted.approval._id, bookingId);
    expect(booked.status).toBe('booked');
    expect(booked.bookingId?.toString()).toBe(String(bookingId));
  });

  it('refuses to book a pending request', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    expect(
      await reasonOf(markApprovalBooked(submitted.approval._id, new Types.ObjectId())),
    ).toMatch(/cannot transition pending/);
  });

  it('is idempotent for the same bookingId', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await approveApproval(managerActor(), String(submitted.approval._id), undefined);
    const bookingId = new Types.ObjectId();
    await markApprovalBooked(submitted.approval._id, bookingId);
    // Second call with the same bookingId is a no-op (returns the doc).
    const again = await markApprovalBooked(submitted.approval._id, bookingId);
    expect(again.status).toBe('booked');
    expect(again.bookingId?.toString()).toBe(String(bookingId));
  });

  it('refuses to overwrite with a different bookingId', async () => {
    const submitted = await submitBusApproval(employeeActor(), baseSubmit());
    await approveApproval(managerActor(), String(submitted.approval._id), undefined);
    await markApprovalBooked(submitted.approval._id, new Types.ObjectId());
    expect(
      await reasonOf(markApprovalBooked(submitted.approval._id, new Types.ObjectId())),
    ).toMatch(/cannot transition booked/);
  });
});
