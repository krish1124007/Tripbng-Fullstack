// Kafila error taxonomy.
//
// Maps to the existing SupplierAdapterError so the search/book pipeline
// handles Kafila failures the same way as eTrav / AirIQ / TBO. We add a
// thin wrapper that captures Kafila-specific signals (status code,
// vendor message, HTTP status) for the audit log + ops dashboards.

import { SupplierAdapterError } from '../types.js';

// Kafila errors classify into the existing SupplierAdapterError code union
// (AUTH | TIMEOUT | UPSTREAM | BAD_REQUEST | NOT_FOUND | EXHAUSTED | CIRCUIT_OPEN).
// We don't extend the union — keeping classification consistent across
// adapters lets ops dashboards filter by code without supplier-specific
// branches. Unsupported capabilities (e.g. HoldPnr on LCC) surface as
// BAD_REQUEST, with the message explaining the gate.

const SUPPLIER_CODE = 'KAFILA';

/** Thin wrapper over SupplierAdapterError that captures Kafila-side
 *  diagnostics for the audit log + ops dashboards. Throw via the helpers
 *  below so the supplierCode + classification stay consistent. */
export class KafilaError extends SupplierAdapterError {
  constructor(
    code: ConstructorParameters<typeof SupplierAdapterError>[0],
    message: string,
    public readonly kafilaStatus?: number,
    public readonly httpStatus?: number,
    public readonly vendorMessage?: string,
  ) {
    super(code, message, SUPPLIER_CODE);
    this.name = 'KafilaError';
  }
}

/** Map a Kafila vendor error (status from body + optional message) to a
 *  typed KafilaError. Falls back to UPSTREAM when we can't classify. */
export function mapKafilaVendorError(
  operation: string,
  kafilaStatus: number,
  vendorMessage: string | undefined,
  httpStatus?: number,
): KafilaError {
  const msg = vendorMessage?.trim() || `Kafila ${operation} failed (status=${kafilaStatus})`;
  // Heuristic classification — Kafila doesn't publish a stable error-code
  // catalog, only free-text messages. We pattern-match the common cases.
  const lower = msg.toLowerCase();
  if (lower.includes('invalid credentials') || lower.includes('unauthorized') || httpStatus === 401) {
    return new KafilaError('AUTH', msg, kafilaStatus, httpStatus, vendorMessage);
  }
  if (lower.includes('rate limit') || httpStatus === 429) {
    return new KafilaError('UPSTREAM', msg, kafilaStatus, httpStatus, vendorMessage);
  }
  if (lower.includes('not supported') || lower.includes('not allowed')) {
    return new KafilaError('UPSTREAM', msg, kafilaStatus, httpStatus, vendorMessage);
  }
  if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
    return new KafilaError('BAD_REQUEST', msg, kafilaStatus, httpStatus, vendorMessage);
  }
  return new KafilaError('UPSTREAM', msg, kafilaStatus, httpStatus, vendorMessage);
}

/** Transport-layer error (timeout, network failure, JSON parse). */
export function transportError(operation: string, cause: Error, httpStatus?: number): KafilaError {
  const isAbort = cause.name === 'AbortError';
  return new KafilaError(
    isAbort ? 'TIMEOUT' : 'UPSTREAM',
    isAbort ? `Kafila ${operation} timed out` : `Kafila ${operation} transport failure: ${cause.message}`,
    undefined,
    httpStatus,
  );
}
