// SeatSeller typed error classes.
//
// SeatSeller's HTTP responses are 200-OK with a free-text error message
// in the body for almost every failure. The client maps those strings
// into typed errors here so the booking service can branch on
// `instanceof` instead of substring matching.
//
// Every error carries the original SeatSeller text + an optional
// blockKey/tin so audit logs and Sentry have enough context to debug
// without re-running the call.

export class SeatSellerError extends Error {
  /** Stable code for log filtering and metric labels. */
  readonly code: string;
  /** Original message from SeatSeller (verbatim, untrimmed). */
  readonly upstream?: string;
  /** Block key / tin / blockKey context if known. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** HTTP status when the error came from a transport-level failure. */
  readonly httpStatus?: number;
  /** Whether this error is safe to retry (idempotent reads only — never
   *  blockTicket/bookTicket/cancelTicket per the spec). */
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    opts: {
      upstream?: string;
      context?: Record<string, unknown>;
      httpStatus?: number;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'SeatSellerError';
    this.code = code;
    this.upstream = opts.upstream;
    this.context = opts.context ? Object.freeze({ ...opts.context }) : undefined;
    this.httpStatus = opts.httpStatus;
    this.retryable = opts.retryable ?? false;
  }
}

// ────────── Concrete error classes ──────────
// Each subclass carries semantic meaning for the booking service to
// branch on. The `code` field is the same as the class name (uppercased
// snake_case) for log/metric stability.

/** Seat is no longer available — somebody else blocked it between
 *  search and block. The booking service surfaces this as a UI hint
 *  to re-fetch tripDetails. */
export class SeatNoLongerAvailableError extends SeatSellerError {
  constructor(opts: { upstream?: string; context?: Record<string, unknown> } = {}) {
    super('SEAT_NO_LONGER_AVAILABLE', 'Seat is no longer available', { ...opts, retryable: false });
    this.name = 'SeatNoLongerAvailableError';
  }
}

/** Block call returned without a blockKey — operator rejected the
 *  attempt, often because of a validation error in passenger details. */
export class TentativeBookingFailedError extends SeatSellerError {
  constructor(opts: { upstream?: string; context?: Record<string, unknown> } = {}) {
    super('TENTATIVE_BOOKING_FAILED', 'Tentative booking failed', { ...opts, retryable: false });
    this.name = 'TentativeBookingFailedError';
  }
}

/** SeatSeller's wallet (the partner-side wallet, not ours) is empty.
 *  Flag the tenant — finance team has to top up before more bookings
 *  succeed. */
export class InsufficientBalanceError extends SeatSellerError {
  constructor(opts: { upstream?: string; context?: Record<string, unknown> } = {}) {
    super('INSUFFICIENT_BALANCE', 'SeatSeller wallet has insufficient balance', {
      ...opts,
      retryable: false,
    });
    this.name = 'InsufficientBalanceError';
  }
}

/** The 8-minute block window expired before bookTicket fired. */
export class ItineraryExpiredError extends SeatSellerError {
  constructor(opts: { upstream?: string; context?: Record<string, unknown> } = {}) {
    super('ITINERARY_EXPIRED', 'Block window expired before booking', { ...opts, retryable: false });
    this.name = 'ItineraryExpiredError';
  }
}

/** BP / DP id sent doesn't match what SeatSeller knows for this trip.
 *  Usually means the BP-DP layout flipped between search and block. */
export class InvalidBoardingPointError extends SeatSellerError {
  constructor(opts: { upstream?: string; context?: Record<string, unknown> } = {}) {
    super('INVALID_BOARDING_POINT', 'Invalid boarding or dropping point', {
      ...opts,
      retryable: false,
    });
    this.name = 'InvalidBoardingPointError';
  }
}

/** Passenger gender doesn't match the seat's reservation (e.g. male
 *  pax assigned to a ladiesSeat). The booking UI must guide the user
 *  to pick from `allowedSeats` for their gender. */
export class GenderRestrictionError extends SeatSellerError {
  constructor(
    public readonly allowedSeats: string[],
    opts: { upstream?: string; context?: Record<string, unknown> } = {},
  ) {
    super('GENDER_RESTRICTION', 'Passenger gender does not match seat reservation', {
      ...opts,
      retryable: false,
    });
    this.name = 'GenderRestrictionError';
  }
}

/** Same idempotency key already produced a tin. Surfaces from the
 *  client's idempotency cache, not from SeatSeller directly. */
export class DuplicateBookingError extends SeatSellerError {
  constructor(
    public readonly tin: string,
    opts: { upstream?: string; context?: Record<string, unknown> } = {},
  ) {
    super('DUPLICATE_BOOKING', `Booking already exists with tin ${tin}`, {
      ...opts,
      retryable: false,
    });
    this.name = 'DuplicateBookingError';
  }
}

/** SeatSeller upstream operator failure — RTC API down, vendor
 *  timeout, etc. Booking service treats this as a soft failure and
 *  triggers checkBookedTicket reconciliation. */
export class VendorFailureError extends SeatSellerError {
  constructor(opts: {
    upstream?: string;
    context?: Record<string, unknown>;
    retryable?: boolean;
  } = {}) {
    super('VENDOR_FAILURE', 'SeatSeller upstream vendor failure', {
      ...opts,
      retryable: opts.retryable ?? false,
    });
    this.name = 'VendorFailureError';
  }
}

/** OAuth token refresh failed — credentials invalid, token endpoint
 *  unreachable, or reply schema changed. Always retryable in the
 *  client (it auto-refreshes on 401), but if the client itself surfaces
 *  this it means refresh exhausted. */
export class OAuthError extends SeatSellerError {
  constructor(opts: {
    upstream?: string;
    httpStatus?: number;
    cause?: unknown;
  } = {}) {
    super('OAUTH_FAILED', 'SeatSeller OAuth refresh failed', {
      ...opts,
      retryable: false,
    });
    this.name = 'OAuthError';
  }
}

/** Plain transport failure — timeout, DNS, 5xx. Idempotent reads
 *  retry once internally; if this surfaces, the retry chain
 *  exhausted. Booking service must NOT retry blocking calls. */
export class TransportError extends SeatSellerError {
  constructor(opts: {
    upstream?: string;
    httpStatus?: number;
    cause?: unknown;
    retryable?: boolean;
  } = {}) {
    super('TRANSPORT', 'SeatSeller transport failure', {
      ...opts,
      retryable: opts.retryable ?? true,
    });
    this.name = 'TransportError';
  }
}

// ────────── Mapper ──────────
// Map SeatSeller's free-text error messages to typed errors. Ordered
// most-specific → least-specific. Returns a generic SeatSellerError
// when nothing matches so the caller still gets a typed error.

/**
 * Map a SeatSeller error message (or HTTP error body) to a typed error.
 * `body` is the original response text (or .error field). `context`
 * is whatever the caller has handy — tin, blockKey, endpoint name.
 */
export function mapSeatSellerError(
  body: string,
  context: Record<string, unknown> = {},
  opts: { httpStatus?: number; cause?: unknown; allowedSeats?: string[] } = {},
): SeatSellerError {
  const lower = body.toLowerCase();
  const upstream = body;
  const o = { upstream, context, httpStatus: opts.httpStatus, cause: opts.cause } as const;

  if (lower.includes('seat') && lower.includes('not available')) {
    return new SeatNoLongerAvailableError(o);
  }
  if (lower.includes('tentative booking failed') || lower.includes('block failed')) {
    return new TentativeBookingFailedError(o);
  }
  if (lower.includes('insufficient balance')) {
    return new InsufficientBalanceError(o);
  }
  if (lower.includes('itinerary expired') || lower.includes('block expired')) {
    return new ItineraryExpiredError(o);
  }
  if (lower.includes('invalid boarding') || lower.includes('invalid dropping')) {
    return new InvalidBoardingPointError(o);
  }
  if (lower.includes('gender') && (lower.includes('restriction') || lower.includes('mismatch'))) {
    return new GenderRestrictionError(opts.allowedSeats ?? [], o);
  }
  if (lower.includes('vendor failure') || lower.includes('operator failure')) {
    return new VendorFailureError(o);
  }
  if (opts.httpStatus === 401 || lower.includes('unauthorized')) {
    return new OAuthError({ upstream, httpStatus: opts.httpStatus, cause: opts.cause });
  }
  return new SeatSellerError('UNKNOWN', body || 'SeatSeller returned an unknown error', o);
}
