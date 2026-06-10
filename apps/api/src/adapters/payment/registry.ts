// Provider registry — loads enabled gateway configs from PaymentGatewayConfig
// (Mongo) and constructs per-provider adapter instances on demand.
//
// Lifecycle:
//   - First lookup hydrates from DB + builds adapter (with `select: '+credentials'`).
//   - Adapter cached per (tenantId, providerCode, environment) for the
//     duration of the process; admin status changes invalidate the cache via
//     `resetRegistry()`.
//
// When no DB config is found, we fall back to env-driven config so dev
// environments keep working before any admin row exists. Production should
// never rely on env fallback — there's a metric we expose for ops.

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { getActiveConfig } from '../../services/payment/payment-config.service.js';
<<<<<<< HEAD
import {
  IciciEazypayProvider,
  type IciciEazypayConfig,
  type IciciEazypayCredentials,
} from './icici-eazypay.provider.js';
import {
  OrangePgProvider,
  type OrangePgConfig,
  type OrangePgCredentials,
} from './orange-pg.provider.js';
=======
import { IciciOrangePgProvider } from './icici-orange-pg/index.js';
import type {
  IciciOrangePgConfig,
  IciciOrangePgCredentials,
} from './icici-orange-pg/types.js';
>>>>>>> 566bd27eb66c25e48cac612ba93cd29c96d1ddb7
import { ManualProvider } from './manual.provider.js';
import { PhonePeProvider, type PhonePeConfig, type PhonePeCredentials } from './phonepe.provider.js';
import {
  PaymentError,
  type PaymentProvider,
  type PaymentProviderCode,
} from './types.js';

interface CacheEntry {
  provider: PaymentProvider;
  configId: string;
  hydratedAt: number;
}

const cache = new Map<string, CacheEntry>();
const TEN_MIN = 10 * 60 * 1000;

function cacheKey(
  tenantId: string,
  code: PaymentProviderCode,
  environment: 'UAT' | 'PROD',
): string {
  return `${tenantId}::${code}::${environment}`;
}

/** Manual is stateless and tenant-agnostic; one instance for all callers. */
const manualSingleton = new ManualProvider();

export interface GetProviderOptions {
  tenantId: string;
  providerCode: PaymentProviderCode;
  environment?: 'UAT' | 'PROD';
}

/**
 * Resolve a configured + active provider for the (tenant, code, env) combo.
 * Throws PaymentError('NOT_CONFIGURED') if no active row exists AND env
 * fallback isn't usable.
 */
export async function getProvider(opts: GetProviderOptions): Promise<PaymentProvider> {
  const envName = opts.environment ?? (process.env.NODE_ENV === 'production' ? 'PROD' : 'UAT');
  if (opts.providerCode === 'MANUAL') return manualSingleton;

  const key = cacheKey(opts.tenantId, opts.providerCode, envName);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.hydratedAt < TEN_MIN) return hit.provider;

  // DB-first — credentials decrypted via the config service.
  const active = await getActiveConfig(opts.tenantId, opts.providerCode, envName);
  if (active) {
    const provider = buildProvider({
      _id: active.configId,
      providerCode: opts.providerCode,
      baseUrl: active.doc.baseUrl,
      returnUrl: active.doc.returnUrl ?? null,
      timeoutMs: active.doc.timeoutMs ?? 30_000,
      credentials: active.credentials,
    });
    cache.set(key, { provider, configId: String(active.configId), hydratedAt: Date.now() });
    return provider;
  }

  // Env fallback (dev only).
  const fallback = buildProviderFromEnv(opts.providerCode, envName);
  if (fallback) {
    logger.warn(
      { providerCode: opts.providerCode, envName },
      'using env-fallback gateway config — production should use PaymentGatewayConfig in DB',
    );
    return fallback;
  }

  throw new PaymentError(
    'NOT_CONFIGURED',
    `No active ${opts.providerCode} config for tenant ${opts.tenantId} (${envName})`,
    opts.providerCode,
  );
}

export function resetRegistry(): void {
  cache.clear();
}

// ────────── Builders ──────────

interface BuildInput {
  _id: unknown;
  providerCode: string;
  baseUrl: string;
  returnUrl?: string | null;
  timeoutMs?: number;
  credentials: Record<string, unknown>;
}

function buildProvider(raw: BuildInput): PaymentProvider {
  const timeoutMs = raw.timeoutMs ?? 30_000;
  if (raw.providerCode === 'ICICI_ORANGE_PG') {
    const creds = raw.credentials as Partial<IciciOrangePgCredentials> & {
      adviceURL?: string;
      initiateSaleUrl?: string;
      commandUrl?: string;
      settlementDetailsUrl?: string;
      userCancelUrl?: string;
    };
    if (!creds.merchantId || !creds.aggregatorID || !creds.key) {
      throw new PaymentError(
        'NOT_CONFIGURED',
        'ICICI Orange PG credentials incomplete (merchantId/aggregatorID/key)',
        'ICICI_ORANGE_PG',
      );
    }
    const cfg: IciciOrangePgConfig = {
      credentials: {
        merchantId: creds.merchantId,
        aggregatorID: creds.aggregatorID,
        key: creds.key,
      },
      endpoints: {
        initiateSale: creds.initiateSaleUrl ?? env.ICICI_ORANGE_PG_INITIATE_SALE_URL,
        command: creds.commandUrl ?? env.ICICI_ORANGE_PG_COMMAND_URL,
        settlementDetails: creds.settlementDetailsUrl ?? env.ICICI_ORANGE_PG_SETTLEMENT_DETAILS_URL,
        userCancel: creds.userCancelUrl ?? env.ICICI_ORANGE_PG_USER_CANCEL_URL,
      },
      returnURL: raw.returnUrl ?? env.ICICI_ORANGE_PG_RETURN_URL ?? '',
      adviceURL: creds.adviceURL ?? env.ICICI_ORANGE_PG_ADVICE_URL ?? '',
      timeoutMs,
    };
    if (!cfg.returnURL) {
      throw new PaymentError(
        'NOT_CONFIGURED',
        'ICICI Orange PG returnURL not set on config or ICICI_ORANGE_PG_RETURN_URL env',
        'ICICI_ORANGE_PG',
      );
    }
    return new IciciOrangePgProvider(cfg);
  }
  if (raw.providerCode === 'ORANGE_PG') {
    const creds = raw.credentials as Partial<OrangePgCredentials>;
    if (!creds.merchantId || !creds.secretKey) {
      throw new PaymentError('NOT_CONFIGURED', 'Orange PG credentials incomplete', 'ORANGE_PG');
    }
    const cfg: OrangePgConfig = {
      credentials: creds as OrangePgCredentials,
      baseUrl: raw.baseUrl,
      commandUrl: (raw.credentials['commandUrl'] as string | undefined) ?? undefined,
      returnUrl: raw.returnUrl ?? '',
      timeoutMs,
    };
    return new OrangePgProvider(cfg);
  }
  if (raw.providerCode === 'PHONEPE') {
    const creds = raw.credentials as Partial<PhonePeCredentials>;
    if (!creds.merchantId || !creds.clientId || !creds.clientSecret || !creds.clientVersion) {
      throw new PaymentError('NOT_CONFIGURED', 'PhonePe credentials incomplete', 'PHONEPE');
    }
    const cfg: PhonePeConfig = {
      credentials: creds as PhonePeCredentials,
      baseUrl: raw.baseUrl,
      returnUrl: raw.returnUrl ?? '',
      timeoutMs,
    };
    return new PhonePeProvider(cfg);
  }
  throw new PaymentError('NOT_CONFIGURED', `Unknown provider ${raw.providerCode}`);
}

function buildProviderFromEnv(
  code: PaymentProviderCode,
  _envName: 'UAT' | 'PROD',
): PaymentProvider | null {
  if (code === 'ICICI_ORANGE_PG') {
    const merchantId = env.ICICI_ORANGE_PG_MERCHANT_ID;
    const aggregatorID = env.ICICI_ORANGE_PG_AGGREGATOR_ID;
    const key = env.ICICI_ORANGE_PG_KEY;
    const returnURL = env.ICICI_ORANGE_PG_RETURN_URL;
    if (!merchantId || !aggregatorID || !key || !returnURL) return null;
    return new IciciOrangePgProvider({
      credentials: { merchantId, aggregatorID, key },
      endpoints: {
        initiateSale: env.ICICI_ORANGE_PG_INITIATE_SALE_URL,
        command: env.ICICI_ORANGE_PG_COMMAND_URL,
        settlementDetails: env.ICICI_ORANGE_PG_SETTLEMENT_DETAILS_URL,
        userCancel: env.ICICI_ORANGE_PG_USER_CANCEL_URL,
      },
      returnURL,
      adviceURL: env.ICICI_ORANGE_PG_ADVICE_URL ?? '',
      timeoutMs: 30_000,
    });
  }
  if (code === 'ORANGE_PG') {
    const merchantId = process.env.ORANGE_PG_MERCHANT_ID;
    const secretKey = process.env.ORANGE_PG_SECRET_KEY;
    const returnUrl = process.env.ORANGE_PG_RETURN_URL;
    const baseUrl =
      process.env.ORANGE_PG_BASE_URL ??
      (env === 'PROD'
        ? 'https://pgpay.icicibank.com/pg/api/v2/initiateSale'
        : 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale');
    if (!merchantId || !secretKey || !returnUrl) return null;
    return new OrangePgProvider({
      credentials: { merchantId, secretKey },
      baseUrl,
      commandUrl: process.env.ORANGE_PG_COMMAND_URL,
      returnUrl,
      timeoutMs: 30_000,
    });
  }
  if (code === 'PHONEPE') {
    const merchantId = process.env.PHONEPE_MERCHANT_ID;
    const clientId = process.env.PHONEPE_CLIENT_ID;
    const clientSecret = process.env.PHONEPE_CLIENT_SECRET;
    const clientVersion = process.env.PHONEPE_CLIENT_VERSION ?? '1';
    const webhookUsername = process.env.PHONEPE_WEBHOOK_USERNAME;
    const webhookPassword = process.env.PHONEPE_WEBHOOK_PASSWORD;
    const baseUrl =
      process.env.PHONEPE_BASE_URL ??
      (_envName === 'PROD'
        ? 'https://api.phonepe.com/apis/pg'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox');
    const returnUrl = process.env.PHONEPE_RETURN_URL;
    if (
      !merchantId ||
      !clientId ||
      !clientSecret ||
      !webhookUsername ||
      !webhookPassword ||
      !returnUrl
    )
      return null;
    return new PhonePeProvider({
      credentials: {
        merchantId,
        clientId,
        clientSecret,
        clientVersion,
        webhookUsername,
        webhookPassword,
      },
      baseUrl,
      returnUrl,
      timeoutMs: 30_000,
    });
  }
  return null;
}
