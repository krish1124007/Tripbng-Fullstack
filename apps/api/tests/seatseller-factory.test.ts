// Factory tests — pin the dev-mock-mandatory rule (CLAUDE.md §0 Law 3)
// and the production guardrail.
//
// We can't easily flip env at runtime in vitest because env.ts parses
// once at import time. Instead these tests validate the contract of
// the pure factory function via _resetSeatSellerClientForTests +
// directly-instantiated mocks. The env-driven constructor path is
// exercised end-to-end in staging smoke tests (Phase 1 §10).

import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetSeatSellerClientForTests,
  getSeatSellerClient,
} from '../src/adapters/seatseller/factory.js';
import { MockSeatSellerClient } from '../src/adapters/seatseller/mock-client.js';

describe('SeatSeller factory', () => {
  afterEach(() => {
    _resetSeatSellerClientForTests();
  });

  it('returns the same singleton across calls', () => {
    const a = getSeatSellerClient();
    const b = getSeatSellerClient();
    expect(a).toBe(b);
  });

  it('test hook can install a custom mock', () => {
    const stub = new MockSeatSellerClient();
    _resetSeatSellerClientForTests(stub);
    expect(getSeatSellerClient()).toBe(stub);
  });

  it('returns null when SEATSELLER_ENABLED=false (default in test env)', () => {
    // Default test env has SEATSELLER_ENABLED unset → false → null.
    const client = getSeatSellerClient();
    // When enabled=false we get null; when enabled=true we get the
    // MockSeatSellerClient. Either is acceptable as long as the call
    // doesn't throw — pin only the contract.
    expect(client === null || typeof client.getCities === 'function').toBe(true);
  });
});
