// Normalized TBO error type — wraps every failure mode we see from TBO so
// callers can switch on `code` without knowing whether the failure was at
// transport layer (HTTP 5xx, timeout) or business layer (Status=2, Error
// block populated).

import { TBO_STATUS, type TboStatus } from './types/auth.js';

export type TboErrorCode =
  | 'TBO_DISABLED' // env.TBO_ENABLED is false
  | 'TBO_NOT_CONFIGURED' // creds missing
  | 'TBO_INVALID_CREDENTIALS' // Status=5
  | 'TBO_INVALID_SESSION' // Status=4 — caller should refresh + retry once
  | 'TBO_INVALID_REQUEST' // Status=3 — programmer error, do not retry
  | 'TBO_FAILED' // Status=2 — surface message
  | 'TBO_TRANSPORT' // 5xx, timeout, network
  | 'TBO_UNKNOWN'; // schema drift, unparseable response

export class TboError extends Error {
  constructor(
    public readonly code: TboErrorCode,
    message: string,
    public readonly meta: {
      method: string;
      tboStatus?: TboStatus;
      tboErrorCode?: number;
      tboMessage?: string;
      httpStatus?: number;
      traceId?: string;
      retryable: boolean;
    },
  ) {
    super(message);
    this.name = 'TboError';
  }
}

/** Map a parsed Status field to our error code. Returns null when the
 *  response was successful so callers can early-return. */
export function statusToErrorCode(status: TboStatus): TboErrorCode | null {
  switch (status) {
    case TBO_STATUS.SUCCESSFUL:
      return null;
    case TBO_STATUS.FAILED:
      return 'TBO_FAILED';
    case TBO_STATUS.INVALID_REQUEST:
      return 'TBO_INVALID_REQUEST';
    case TBO_STATUS.INVALID_SESSION:
      return 'TBO_INVALID_SESSION';
    case TBO_STATUS.INVALID_CREDENTIALS:
      return 'TBO_INVALID_CREDENTIALS';
    default:
      return 'TBO_UNKNOWN';
  }
}
