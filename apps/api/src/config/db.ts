import mongoose from 'mongoose';
import { env, isProd } from './env.js';
import { logger } from './logger.js';
import { applyTenancyGuardGlobally } from '../models/plugins/tenancy-guard.js';

mongoose.set('strictQuery', true);

export async function connectMongo(): Promise<void> {
  await mongoose.connect(env.MONGO_URI, {
    maxPoolSize: env.MONGO_POOL_SIZE,
    serverSelectionTimeoutMS: 5000,
  });
  logger.info({ host: mongoose.connection.host, db: mongoose.connection.name }, 'mongo connected');

  mongoose.connection.on('error', (err) => logger.error({ err }, 'mongo error'));
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));

  // Replica-set guard — wallet + booking flows require Mongo transactions,
  // which need a replica set. In production, refuse to boot without one.
  // In dev, log loudly and continue (single-node Mongo silently drops txns
  // and we'd rather see this surface in the boot log than as data drift).
  await assertReplicaSet();

  // Apply tenancy guard to every model that has a `tenantId` field (loaded
  // by now via the model `index.ts` barrel imports).
  applyTenancyGuardGlobally(mongoose);
  logger.info(
    { models: Object.keys(mongoose.models).length },
    'tenancy-guard applied globally',
  );
}

async function assertReplicaSet(): Promise<void> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return;
    await admin.command({ replSetGetStatus: 1 });
    logger.info('mongo replica set: ok (transactions available)');
  } catch (err) {
    const message =
      'MONGO IS NOT A REPLICA SET — wallet/booking transactions will silently degrade to non-atomic. ' +
      'Production REQUIRES `replicaSet=` in MONGO_URI. Dev may proceed but expect race conditions.';
    if (isProd) {
      logger.fatal({ err }, message);
      throw new Error(message);
    }
    logger.warn({ err: err instanceof Error ? err.message : err }, message);
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
