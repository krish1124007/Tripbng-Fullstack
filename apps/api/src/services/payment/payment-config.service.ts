// Helpers for reading + writing PaymentGatewayConfig credentials.
// Credentials are stored as AES-256-GCM ciphertext on the model; this module
// is the only place that decrypts. Audit-log every read so we can prove who
// touched merchant secrets and when.

import { Types } from 'mongoose';
import { logger } from '../../config/logger.js';
import { PaymentGatewayConfig, type PaymentGatewayConfigDoc } from '../../models/PaymentGatewayConfig.js';
import { decryptJson, encryptJson } from '../../utils/field-encryption.js';

export interface RawConfigWithCredentials<T = Record<string, unknown>> {
  configId: Types.ObjectId;
  doc: PaymentGatewayConfigDoc;
  credentials: T;
}

/** Fetch + decrypt credentials for the registry to use. Reads + decrypt are
 *  log-traced so audit can prove access. */
export async function getActiveConfig<T = Record<string, unknown>>(
  tenantId: string,
  providerCode: 'ICICI_EAZYPAY' | 'ORANGE_PG' | 'PHONEPE' | 'RAZORPAY',
  environment: 'UAT' | 'PROD',
): Promise<RawConfigWithCredentials<T> | null> {
  const cfg = await PaymentGatewayConfig.findOne({
    tenantId: new Types.ObjectId(tenantId),
    providerCode,
    environment,
    status: 'ACTIVE',
  })
    .select('+encryptedCredentials')
    .exec();
  if (!cfg) return null;

  let credentials: T = {} as T;
  if (cfg.encryptedCredentials) {
    try {
      credentials = decryptJson<T>(cfg.encryptedCredentials);
    } catch (err) {
      logger.error(
        { err, providerCode, configId: cfg._id.toString() },
        'failed to decrypt gateway credentials — wrong KMS key?',
      );
      throw new Error('Could not decrypt gateway credentials');
    }
  }

  logger.info(
    { providerCode, configId: cfg._id.toString(), tenantId },
    'gateway-config-credentials-read',
  );
  return { configId: cfg._id, doc: cfg, credentials };
}

/** Store credentials encrypted at rest. Plaintext is never persisted. */
export async function setCredentials(
  configId: Types.ObjectId,
  credentials: Record<string, unknown>,
  actorUserId?: Types.ObjectId,
): Promise<void> {
  const ciphertext = encryptJson(credentials);
  await PaymentGatewayConfig.updateOne(
    { _id: configId },
    {
      $set: {
        encryptedCredentials: ciphertext,
        lastModifiedBy: actorUserId ?? null,
      },
    },
  );
  logger.info(
    { configId: configId.toString(), actorUserId: actorUserId?.toString() },
    'gateway-config-credentials-rotated',
  );
}
