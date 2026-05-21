// VisaSupplierRegistry — single source of truth for which adapter
// handles which visa supplier code. Mirror of holiday/registry.ts.

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { MockVisaAdapter } from './mock-visa.adapter.js';
import { VFSVisaAdapter } from './vfs-visa.adapter.js';
import {
  VisaAdapterError,
  type VisaSupplierAdapter,
  type VisaSupplierCode,
} from './types.js';

const cache = new Map<VisaSupplierCode, VisaSupplierAdapter>();

export function visaSupplier(code: VisaSupplierCode): VisaSupplierAdapter {
  const cached = cache.get(code);
  if (cached) return cached;

  let adapter: VisaSupplierAdapter;
  switch (code) {
    case 'MOCK_VISA':
    case 'CUSTOM':
    case 'EMBASSY':
      // EMBASSY + CUSTOM both ride on the mock adapter until per-supplier
      // integrations land. EMBASSY is reserved for direct embassy e-visa
      // portals (Türkiye, UAE, etc.) which usually don't have an API at
      // all — they're handled by manual ops with the mock simulating the
      // booking lifecycle for accounting.
      adapter = new MockVisaAdapter();
      break;

    case 'VFS':
      if (!env.VFS_VISA_ENABLED) {
        throw new VisaAdapterError(
          'NOT_CONFIGURED',
          'VFS Global adapter is disabled — set VFS_VISA_ENABLED=true and provision credentials',
          code,
        );
      }
      adapter = new VFSVisaAdapter();
      break;

    case 'BLS':
    case 'ATLYS':
      // Skeleton placeholders. We've reserved the supplier codes so
      // booking docs can be tagged ahead of time, but no adapter ships
      // yet — every call routes to a NOT_IMPLEMENTED error.
      throw new VisaAdapterError(
        'NOT_IMPLEMENTED',
        `${code} adapter is not yet implemented — see docs/PHASE_D_SUPPLIER_BLOCKERS.md`,
        code,
      );

    default: {
      const _: never = code;
      throw new VisaAdapterError(
        'NOT_CONFIGURED',
        `unknown visa supplier code ${String(_)}`,
        'MOCK_VISA',
      );
    }
  }

  cache.set(code, adapter);
  return adapter;
}

export function defaultVisaSupplier(): VisaSupplierAdapter {
  return visaSupplier('MOCK_VISA');
}

export function _setVisaSupplier(
  code: VisaSupplierCode,
  adapter: VisaSupplierAdapter,
): void {
  cache.set(code, adapter);
  logger.debug({ code }, '_setVisaSupplier — adapter overridden (test path only)');
}

export function _resetVisaRegistry(): void {
  cache.clear();
}
