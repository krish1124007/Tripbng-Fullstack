import { logger } from '../config/logger.js';
import {
  SupplierAdapterError,
  type Capability,
  type HealthStatus,
  type NormalizedBookingDetails,
  type NormalizedCancelRequest,
  type NormalizedCancelResponse,
  type NormalizedHoldRequest,
  type NormalizedHoldResponse,
  type NormalizedSearchRequest,
  type NormalizedSearchResponse,
  type NormalizedTicketRequest,
  type NormalizedTicketResponse,
  type SupplierAdapter,
} from './types.js';

// CircuitBreakerState — basic in-memory breaker per supplier. Trips after N failures within
// a rolling window, then half-opens after cooldown. The full opossum library is heavier than
// needed here; this gives us the same operational shape.
export class CircuitBreaker {
  private failures: number[] = [];
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttemptAt = 0;

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number,
    private readonly cooldownMs: number,
  ) {}

  canRequest(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptAt) {
      this.state = 'HALF_OPEN';
      return true;
    }
    return this.state === 'HALF_OPEN';
  }

  recordSuccess(): void {
    this.failures = [];
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = now + this.cooldownMs;
    }
  }

  get status(): { state: string; failureCount: number } {
    return { state: this.state, failureCount: this.failures.length };
  }
}

// withTimeout — race a promise against a deadline. Throws SupplierAdapterError(TIMEOUT)
// on the deadline path so callers can categorise accurately.
export async function withTimeout<T>(p: Promise<T>, ms: number, supplierCode: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new SupplierAdapterError(
                'TIMEOUT',
                `${supplierCode} timed out after ${ms}ms`,
                supplierCode,
              ),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// BaseAdapter — adapter-friendly mixin: common breaker + timeout + structured logging.
// Concrete adapters extend this and implement search/hold/ticket etc.
export abstract class BaseAdapter implements SupplierAdapter {
  abstract readonly code: string;
  abstract readonly name: string;
  abstract readonly capabilities: readonly Capability[];

  protected readonly breaker = new CircuitBreaker(5, 30_000, 60_000);
  // Default per-call timeout. Subclasses (e.g. EtravAdapter) can widen this for
  // suppliers whose end-to-end search legitimately takes longer than 3 s.
  protected readonly timeoutMs: number = 3000;

  abstract search(req: NormalizedSearchRequest): Promise<NormalizedSearchResponse>;
  abstract hold(req: NormalizedHoldRequest): Promise<NormalizedHoldResponse>;
  abstract ticket(req: NormalizedTicketRequest): Promise<NormalizedTicketResponse>;
  abstract cancel(req: NormalizedCancelRequest): Promise<NormalizedCancelResponse>;
  abstract retrieveBooking(ref: string): Promise<NormalizedBookingDetails>;

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true };
  }

  // Wraps an adapter call with breaker + timeout + structured logs.
  protected async guarded<T>(action: string, fn: () => Promise<T>): Promise<T> {
    if (!this.breaker.canRequest()) {
      throw new SupplierAdapterError('CIRCUIT_OPEN', `breaker open for ${this.code}`, this.code);
    }
    const startedAt = Date.now();
    try {
      const result = await withTimeout(fn(), this.timeoutMs, this.code);
      this.breaker.recordSuccess();
      logger.debug({ supplier: this.code, action, ms: Date.now() - startedAt }, 'adapter call ok');
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      logger.warn(
        { supplier: this.code, action, ms: Date.now() - startedAt, err },
        'adapter call failed',
      );
      throw err;
    }
  }
}
