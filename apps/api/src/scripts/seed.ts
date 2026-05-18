import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../config/db.js';
import { logger } from '../config/logger.js';
import { Tenant } from '../models/Tenant.js';
import { User } from '../models/User.js';
import { Agency } from '../models/Agency.js';
import { Distributor } from '../models/Distributor.js';
import { Counter } from '../models/Counter.js';
import { hashPassword } from '../utils/password.js';
import { CODE_PREFIX, formatCode } from '@tripbng/shared';

const DEFAULT_PASSWORD = 'Tripbng@123';

async function resetCounters() {
  await Counter.deleteMany({});
}

async function nextSeq(prefix: string) {
  const doc = await Counter.findOneAndUpdate(
    { prefix },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return doc.seq;
}

async function seed() {
  await connectMongo();
  logger.info('seeding…');

  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Agency.deleteMany({}),
    Distributor.deleteMany({}),
  ]);
  await resetCounters();

  const tenant = await Tenant.create({
    code: 'tripbng',
    name: 'TripBng',
    domain: 'tripbng.dev',
  });

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  // 1 super admin
  const adminCode = formatCode(CODE_PREFIX.SUPER_ADMIN, await nextSeq(CODE_PREFIX.SUPER_ADMIN));
  const admin = await User.create({
    tenantId: tenant._id,
    userCode: adminCode,
    role: 'SUPER_ADMIN',
    email: 'admin@tripbng.dev',
    mobile: '+919999900001',
    fullName: 'Super Admin',
    passwordHash,
    status: 'ACTIVE',
  });

  // 2 distributors
  const distributors = [];
  for (let i = 1; i <= 2; i++) {
    const distCode = formatCode(CODE_PREFIX.DISTRIBUTOR, await nextSeq(CODE_PREFIX.DISTRIBUTOR));
    const ownerCode = formatCode(CODE_PREFIX.DISTRIBUTOR, await nextSeq(CODE_PREFIX.DISTRIBUTOR));
    const owner = await User.create({
      tenantId: tenant._id,
      userCode: ownerCode,
      role: 'DISTRIBUTOR',
      email: `dist${i}@tripbng.dev`,
      mobile: `+91999990010${i}`,
      fullName: `Distributor ${i} Owner`,
      passwordHash,
      status: 'ACTIVE',
      createdBy: admin._id,
    });
    const dist = await Distributor.create({
      tenantId: tenant._id,
      distributorCode: distCode,
      companyName: `Distributor ${i} Pvt Ltd`,
      country: 'IN',
      state: i === 1 ? 'Maharashtra' : 'Karnataka',
      city: i === 1 ? 'Mumbai' : 'Bengaluru',
      pincode: i === 1 ? '400001' : '560001',
      address: `${i}00 Main Street`,
      overrideCommissionPercent: 2,
      ownerUserId: owner._id,
      status: 'ACTIVE',
      createdBy: admin._id,
    });
    owner.distributorId = dist._id;
    await owner.save();
    distributors.push(dist);
  }

  // 5 agencies — 2 under dist1, 2 under dist2, 1 direct under platform
  const distAssignments = [
    distributors[0]!,
    distributors[0]!,
    distributors[1]!,
    distributors[1]!,
    null,
  ];
  for (let i = 1; i <= 5; i++) {
    const distAssignment = distAssignments[i - 1] ?? null;
    const agencyCode = formatCode(CODE_PREFIX.AGENCY, await nextSeq(CODE_PREFIX.AGENCY));
    const ownerCode = formatCode(CODE_PREFIX.AGENCY, await nextSeq(CODE_PREFIX.AGENCY));
    const owner = await User.create({
      tenantId: tenant._id,
      userCode: ownerCode,
      role: 'AGENCY',
      email: `agency${i}@tripbng.dev`,
      mobile: `+9199999020${i.toString().padStart(2, '0')}`,
      fullName: `Agency ${i} Owner`,
      passwordHash,
      distributorId: distAssignment?._id ?? null,
      status: 'ACTIVE',
      createdBy: admin._id,
    });
    const agency = await Agency.create({
      tenantId: tenant._id,
      agencyCode,
      companyName: `Agency ${i} Travels`,
      country: 'IN',
      state: 'Maharashtra',
      city: 'Pune',
      pincode: '411001',
      address: `Plot ${i}, MG Road`,
      distributorId: distAssignment?._id ?? null,
      ownerUserId: owner._id,
      status: 'ACTIVE',
      paymentMethods: { wallet: true, credit: false, deposit: false },
      createdBy: admin._id,
    });
    owner.agencyId = agency._id;
    await owner.save();
    if (distAssignment) {
      await Distributor.updateOne({ _id: distAssignment._id }, { $inc: { agencyCount: 1 } });
    }
  }

  logger.info(
    {
      tenantId: String(tenant._id),
      counts: {
        users: await User.countDocuments(),
        agencies: await Agency.countDocuments(),
        distributors: await Distributor.countDocuments(),
      },
    },
    'seed done',
  );
  logger.info('login: admin@tripbng.dev / Tripbng@123');

  await disconnectMongo();
}

seed().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
