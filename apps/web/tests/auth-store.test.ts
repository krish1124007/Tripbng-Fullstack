// Phase-E baseline tests — zustand auth store. Pure state container,
// no React tree needed; we operate on the store directly via getState /
// setState. Tests reset the store between cases so cross-test bleed
// can't masquerade as a passing case.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '@tripbng/shared';
import { useAuthStore, type AuthUser } from '@/lib/auth-store';

const FIXTURE_USER: AuthUser = {
  id: 'usr-1',
  userCode: 'U0001',
  email: 'a@b.com',
  fullName: 'Test User',
  role: 'AGENCY' as Role,
  agencyId: 'agc-1',
  distributorId: null,
  twoFactorEnabled: false,
  permissions: ['booking:read:own', 'wallet:read:own'],
};

beforeEach(() => {
  // Reset to initial state — zustand exposes `setState` for this kind
  // of test fixture wiring.
  useAuthStore.setState({
    user: null,
    accessToken: null,
    hydrated: false,
  });
});

describe('useAuthStore', () => {
  it('starts empty', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.hydrated).toBe(false);
  });

  it('setAuth populates user + token together', () => {
    useAuthStore.getState().setAuth(FIXTURE_USER, 'acc-token-1');
    const s = useAuthStore.getState();
    expect(s.user).toEqual(FIXTURE_USER);
    expect(s.accessToken).toBe('acc-token-1');
  });

  it('setAccessToken rotates the token without dropping the user', () => {
    useAuthStore.getState().setAuth(FIXTURE_USER, 'old');
    useAuthStore.getState().setAccessToken('new');
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('new');
    expect(s.user).toEqual(FIXTURE_USER); // unchanged
  });

  it('clear wipes user + token (but leaves hydrated flag alone)', () => {
    useAuthStore.getState().setAuth(FIXTURE_USER, 'tok');
    useAuthStore.getState().setHydrated();
    useAuthStore.getState().clear();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.hydrated).toBe(true); // clear() does NOT touch hydration
  });

  it('setHydrated flips the flag exactly once', () => {
    useAuthStore.getState().setHydrated();
    expect(useAuthStore.getState().hydrated).toBe(true);
    // Calling again is a no-op (no toggle behaviour by design).
    useAuthStore.getState().setHydrated();
    expect(useAuthStore.getState().hydrated).toBe(true);
  });
});
