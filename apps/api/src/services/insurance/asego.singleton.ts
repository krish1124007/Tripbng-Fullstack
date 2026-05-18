// Lazy singleton for AsegoClient + identity config. Mirrors the eTrav / AirIQ
// pattern in adapters/registry.ts: built once at first use, returns null when
// the integration is disabled or env is missing so the routes can return 503
// gracefully instead of crashing.

import { AsegoClient, readAsegoClientConfigFromEnv } from '../../adapters/asego/client.js';
import {
  readAsegoIdentityConfig,
  type AsegoIdentityConfig,
} from '../../adapters/asego/identity.js';
import { logger } from '../../config/logger.js';

export interface AsegoContext {
  client: AsegoClient;
  identity: AsegoIdentityConfig;
}

let cached: AsegoContext | null | undefined;

/** Returns null if ASEGO_ENABLED is false or any required env var is missing. */
export function getAsegoContext(): AsegoContext | null {
  if (cached !== undefined) return cached;
  if (process.env.ASEGO_ENABLED !== 'true') {
    cached = null;
    return null;
  }
  const clientCfg = readAsegoClientConfigFromEnv();
  const identity = readAsegoIdentityConfig();
  if (!clientCfg || !identity) {
    logger.warn('ASEGO_ENABLED=true but ASEGO_* env vars are missing — disabling insurance');
    cached = null;
    return null;
  }
  cached = { client: new AsegoClient(clientCfg), identity };
  logger.info({ baseUrl: clientCfg.baseUrl }, 'ASEGO insurance adapter initialised');
  return cached;
}

/** For tests — drop the cached singleton so the next call re-reads env. */
export function resetAsegoContextForTests() {
  cached = undefined;
}
