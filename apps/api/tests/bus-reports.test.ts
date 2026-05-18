// Bus reports tests — aggregation correctness + CSV serialiser.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/db.js';
import { BusBooking } from '../src/models/BusBooking.js';
import { Employee } from '../src/models/Employee.js';
import { Tenant } from '../src/models/Tenant.js';
import {
  reportToCsv,
  runBusReport,
  type BusReportResponse,
} from '../src/services/bus/reports.service.js';

process.env.MONGO_URI = 'mongodb://localhost:27017/tripbng_b2b_test_bus_reports';

let tenantId: string;
let agencyId: string;
let employee1Id: string;
let employee2Id: string;

async function reset(): Promise<void> {
  await Promise.all([
    BusBooking.deleteMany({}),
    Employee.deleteMany({}),
    Tenant.deleteMany({}),
  ]);

  const tenant = await Tenant.create({ code: 'rpt', name: 'Reports Test' });
  tenantId = String(tenant._id);
  agencyId = new Types.ObjectId().toString();

  const e1 = await Employee.create({
    tenantId,
    agencyId: new Types.ObjectId(agencyId),
    empCode: 'E-001',
    name: 'Alice Test',
    email: 'alice@reports.test',
    mobile: '+919876543210',
    gender: 'FEMALE',
    status: 'ACTIVE',
  });
  employee1Id = String(e1._id);

  const e2 = await Employee.create({
    tenantId,
    agencyId: new Types.ObjectId(agencyId),
    empCode: 'E-002',
    name: 'Bob Test',
    email: 'bob@reports.test',
    mobile: '+919876543211',
    gender: 'MALE',
    status: 'ACTIVE',
  });
  employee2Id = String(e2._id);
}

const seedBooking = async (overrides: {
  status: 'BOOKED' | 'CANCELLED' | 'OPERATOR_CANCELLED' | 'PARTIALLY_CANCELLED' | 'FAILED';
  employeeId: string;
  totalPaise: number;
  operatorName: string;
  createdAt?: Date;
}): Promise<void> => {
  const inserted = await BusBooking.create({
    tenantId,
    agencyId,
    bookingRef: `TBNG-BUS-${Math.floor(Math.random() * 1_000_000)}`,
    approvalId: new Types.ObjectId(),
    employeeId: overrides.employeeId,
    bookedByUserId: new Types.ObjectId(),
    blockKey: `BLK-${Math.random().toString(36).slice(2, 10)}`,
    inventoryId: 'INV-X',
    trip: {
      operatorId: 9001,
      operatorName: overrides.operatorName,
      busType: 'AC Sleeper',
      sourceCityId: 122,
      sourceCityName: 'Bangalore',
      destinationCityId: 124,
      destinationCityName: 'Chennai',
      doj: '2026-08-15',
      departureAt: new Date().toISOString(),
      arrivalAt: new Date(Date.now() + 8 * 60 * 60_000).toISOString(),
      nextDay: false,
      boardingPoint: {
        id: 1001,
        name: 'Majestic',
        address: '',
        landmark: '',
        contact: '',
        timeAt: new Date().toISOString(),
        timeMinutes: 1290,
      },
      droppingPoint: {
        id: 2001,
        name: 'CMBT',
        address: '',
        landmark: '',
        contact: '',
        timeAt: new Date().toISOString(),
        timeMinutes: 1800,
      },
      isAc: true,
      isSleeper: true,
      bpDpSeatLayout: false,
      callFareBreakupApi: false,
      mTicketEnabled: true,
    },
    passengers: [
      {
        seatName: 'L3',
        title: 'Mrs',
        name: 'Test',
        age: 30,
        gender: 'FEMALE',
        mobile: '+910000000000',
        email: 'a@b.test',
        primary: true,
        ladiesSeat: false,
        farePaise: overrides.totalPaise,
      },
    ],
    fareBreakup: {
      baseFarePaise: overrides.totalPaise,
      operatorServiceChargePaise: 0,
      serviceTaxPaise: 0,
      bookingFeePaise: 0,
      totalPaise: overrides.totalPaise,
      rtcCustomerPriceBreakUp: null,
    },
    status: overrides.status,
    cancellationPolicyString: '',
    partialCancellationAllowed: true,
  });
  if (overrides.createdAt) {
    // Force createdAt via the raw collection — Mongoose's timestamps
    // middleware would otherwise rewrite it. We bypass entirely so the
    // BY_MONTH bucketing tests can pin specific calendar months.
    await BusBooking.collection.updateOne(
      { _id: inserted._id },
      { $set: { createdAt: overrides.createdAt } },
    );
  }
};

const ctx = (role: 'AGENCY' | 'SUPER_ADMIN' = 'AGENCY') => ({
  tenantId,
  role,
  agencyId,
});

beforeAll(async () => {
  await connectMongo();
});
afterAll(async () => {
  await disconnectMongo();
});
beforeEach(async () => {
  await reset();
});

// ────────── SUMMARY ──────────

describe('runBusReport — SUMMARY', () => {
  it('aggregates by status with counts + paise totals', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'TripBNG' });
    await seedBooking({ status: 'BOOKED', employeeId: employee2Id, totalPaise: 200_000, operatorName: 'TripBNG' });
    await seedBooking({ status: 'CANCELLED', employeeId: employee1Id, totalPaise: 50_000, operatorName: 'TripBNG' });

    const r = await runBusReport(ctx(), { type: 'SUMMARY' });
    expect(r.type).toBe('SUMMARY');
    expect(r.rows).toHaveLength(2); // BOOKED + CANCELLED

    const byStatus = Object.fromEntries(r.rows.map((row) => [row.status, row]));
    expect(byStatus.BOOKED!.count).toBe(2);
    expect(byStatus.BOOKED!.totalPaise).toBe(300_000);
    expect(byStatus.CANCELLED!.count).toBe(1);
    expect(byStatus.CANCELLED!.totalPaise).toBe(50_000);

    expect(r.totals).toEqual({ count: 3, totalPaise: 350_000 });
  });

  it('returns empty rows when no bookings match', async () => {
    const r = await runBusReport(ctx(), { type: 'SUMMARY' });
    expect(r.rows).toEqual([]);
    expect(r.totals).toEqual({ count: 0, totalPaise: 0 });
  });
});

// ────────── BY_EMPLOYEE ──────────

describe('runBusReport — BY_EMPLOYEE', () => {
  it('groups by employee with cancelled / booked counts', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'A' });
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'A' });
    await seedBooking({ status: 'CANCELLED', employeeId: employee1Id, totalPaise: 50_000, operatorName: 'A' });
    await seedBooking({ status: 'BOOKED', employeeId: employee2Id, totalPaise: 200_000, operatorName: 'B' });

    const r = await runBusReport(ctx(), { type: 'BY_EMPLOYEE' });
    expect(r.rows.length).toBe(2);

    // Sorted by totalPaise desc → Alice (250k) before Bob (200k).
    expect(r.rows[0]!.employeeName).toBe('Alice Test');
    expect(r.rows[0]!.bookings).toBe(3);
    expect(r.rows[0]!.bookedCount).toBe(2);
    expect(r.rows[0]!.cancelledCount).toBe(1);
    expect(r.rows[0]!.totalPaise).toBe(250_000);

    expect(r.rows[1]!.employeeName).toBe('Bob Test');
    expect(r.rows[1]!.bookings).toBe(1);
    expect(r.rows[1]!.bookedCount).toBe(1);
    expect(r.rows[1]!.cancelledCount).toBe(0);
    expect(r.rows[1]!.totalPaise).toBe(200_000);
  });
});

// ────────── BY_MONTH ──────────

describe('runBusReport — BY_MONTH', () => {
  it('buckets bookings by yyyy-MM', async () => {
    await seedBooking({
      status: 'BOOKED',
      employeeId: employee1Id,
      totalPaise: 100_000,
      operatorName: 'A',
      createdAt: new Date('2026-04-15T10:00:00Z'),
    });
    await seedBooking({
      status: 'BOOKED',
      employeeId: employee1Id,
      totalPaise: 200_000,
      operatorName: 'A',
      createdAt: new Date('2026-04-22T10:00:00Z'),
    });
    await seedBooking({
      status: 'BOOKED',
      employeeId: employee1Id,
      totalPaise: 50_000,
      operatorName: 'A',
      createdAt: new Date('2026-05-01T10:00:00Z'),
    });

    const r = await runBusReport(ctx(), {
      type: 'BY_MONTH',
      from: new Date('2026-04-01T00:00:00Z'),
      to: new Date('2026-05-31T23:59:59Z'),
    });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.month).toBe('2026-04');
    expect(r.rows[0]!.bookings).toBe(2);
    expect(r.rows[0]!.totalPaise).toBe(300_000);
    expect(r.rows[1]!.month).toBe('2026-05');
    expect(r.rows[1]!.totalPaise).toBe(50_000);
  });
});

// ────────── BY_OPERATOR ──────────

describe('runBusReport — BY_OPERATOR', () => {
  it('aggregates by operator name', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'TripBNG Travels' });
    await seedBooking({ status: 'BOOKED', employeeId: employee2Id, totalPaise: 200_000, operatorName: 'TripBNG Travels' });
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 50_000, operatorName: 'KSRTC' });

    const r = await runBusReport(ctx(), { type: 'BY_OPERATOR' });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.operator).toBe('TripBNG Travels');
    expect(r.rows[0]!.totalPaise).toBe(300_000);
    expect(r.rows[1]!.operator).toBe('KSRTC');
  });
});

// ────────── Tenant scoping ──────────

describe('runBusReport — tenant + agency scope', () => {
  it('AGENCY role sees only its own agency data', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'A' });
    // Insert a row for a different agency under the SAME tenant.
    const otherAgencyId = new Types.ObjectId().toString();
    const otherEmp = await Employee.create({
      tenantId,
      agencyId: new Types.ObjectId(otherAgencyId),
      empCode: 'E-OTHER',
      name: 'Other',
      email: 'other@b.test',
      mobile: '+910000000099',
      gender: 'OTHER',
      status: 'ACTIVE',
    });
    await seedBooking({ status: 'BOOKED', employeeId: String(otherEmp._id), totalPaise: 999_000, operatorName: 'A' });
    // Force the other booking onto the other agencyId via $set since
    // seedBooking hardcodes module-level agencyId.
    await BusBooking.updateOne(
      { employeeId: otherEmp._id },
      { $set: { agencyId: new Types.ObjectId(otherAgencyId) } },
    );

    const r = await runBusReport(ctx('AGENCY'), { type: 'SUMMARY' });
    expect(r.totals?.totalPaise).toBe(100_000);
    expect(r.totals?.count).toBe(1);
  });

  it('SUPER_ADMIN with no agency override sees full tenant', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 100_000, operatorName: 'A' });
    const otherAgencyId = new Types.ObjectId();
    await BusBooking.updateOne(
      {},
      { $set: { agencyId: otherAgencyId } },
    );
    // Add a second booking under the original agencyId.
    await seedBooking({ status: 'BOOKED', employeeId: employee2Id, totalPaise: 200_000, operatorName: 'B' });

    const r = await runBusReport(
      { tenantId, role: 'SUPER_ADMIN', agencyId: null },
      { type: 'SUMMARY' },
    );
    expect(r.totals?.totalPaise).toBe(300_000);
    expect(r.totals?.count).toBe(2);
  });
});

// ────────── CSV serialiser ──────────

describe('reportToCsv', () => {
  it('emits headers + rows + totals row', async () => {
    await seedBooking({ status: 'BOOKED', employeeId: employee1Id, totalPaise: 123_400, operatorName: 'TripBNG' });
    const r = await runBusReport(ctx(), { type: 'SUMMARY' });
    const csv = reportToCsv(r);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Status,Bookings,Total spend');
    // Body row.
    expect(lines[1]).toBe('BOOKED,1,1234.00');
    // Totals row.
    expect(lines[2]).toBe('TOTAL,1,1234.00');
  });

  it('escapes commas and quotes in string cells', () => {
    const r: BusReportResponse = {
      type: 'BY_OPERATOR',
      generatedAt: new Date().toISOString(),
      from: null,
      to: null,
      columns: [
        { key: 'operator', label: 'Operator', format: 'string' },
        { key: 'totalPaise', label: 'Total', format: 'paise' },
      ],
      rows: [{ operator: 'KSR, "TC"', totalPaise: 5000 }],
      totals: null,
    };
    const csv = reportToCsv(r);
    expect(csv).toContain('"KSR, ""TC"""');
    expect(csv).toContain('50.00');
  });

  it('renders paise as 2dp rupees', () => {
    const r: BusReportResponse = {
      type: 'SUMMARY',
      generatedAt: new Date().toISOString(),
      from: null,
      to: null,
      columns: [
        { key: 'status', label: 'Status', format: 'string' },
        { key: 'totalPaise', label: 'Total', format: 'paise' },
      ],
      rows: [{ status: 'BOOKED', totalPaise: 99 }],
      totals: null,
    };
    const csv = reportToCsv(r);
    expect(csv).toContain('BOOKED,0.99');
  });
});
