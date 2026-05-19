// Fixed error code catalog. Frontend maps codes to user-facing copy.
// New codes must be added here so FE and BE stay in lockstep.
export const ERROR_CODES = {
  // 400 — validation
  VALIDATION_ERROR: { http: 400, message: 'Invalid input' },
  INVALID_CREDENTIALS: { http: 401, message: 'Invalid email or password' },
  INVALID_TOTP: { http: 401, message: 'Invalid 2FA code' },
  TOTP_REQUIRED: { http: 401, message: 'Two-factor code required' },
  TOKEN_EXPIRED: { http: 401, message: 'Session expired, please log in again' },
  TOKEN_INVALID: { http: 401, message: 'Invalid authentication token' },

  // 403 — authorization
  FORBIDDEN: { http: 403, message: 'You do not have permission to perform this action' },
  ACCOUNT_SUSPENDED: { http: 403, message: 'Account suspended. Contact support.' },
  ACCOUNT_BLOCKED: { http: 403, message: 'Account blocked.' },
  ACCOUNT_LOCKED: { http: 423, message: 'Account temporarily locked due to failed login attempts' },

  // 404
  NOT_FOUND: { http: 404, message: 'Resource not found' },
  USER_NOT_FOUND: { http: 404, message: 'User not found' },
  AGENCY_NOT_FOUND: { http: 404, message: 'Agency not found' },
  DISTRIBUTOR_NOT_FOUND: { http: 404, message: 'Distributor not found' },

  // 409
  EMAIL_TAKEN: { http: 409, message: 'An account with this email already exists' },
  MOBILE_TAKEN: { http: 409, message: 'An account with this mobile already exists' },
  IDEMPOTENCY_CONFLICT: { http: 409, message: 'Duplicate request' },
  TOTP_ALREADY_ENABLED: { http: 409, message: '2FA is already enrolled for this account' },

  // 422 — business rule
  INSUFFICIENT_WALLET: { http: 422, message: 'Insufficient wallet balance' },
  CREDIT_LIMIT_EXCEEDED: { http: 422, message: 'Credit limit exceeded' },
  INVENTORY_EXHAUSTED: { http: 422, message: 'No seats remaining in this inventory' },
  HOLD_EXPIRED: { http: 422, message: 'Hold has expired' },

  // 429
  RATE_LIMITED: { http: 429, message: 'Too many requests, please slow down' },

  // 500
  INTERNAL_ERROR: { http: 500, message: 'Something went wrong' },
  SUPPLIER_UNAVAILABLE: { http: 503, message: 'Supplier currently unavailable' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly http: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_CODES[code].message);
    this.name = 'AppError';
    this.code = code;
    this.http = ERROR_CODES[code].http;
    if (details !== undefined) this.details = details;
  }
}
