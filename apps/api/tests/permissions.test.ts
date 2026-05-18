import { describe, it, expect } from 'vitest';
import { hasPermission, getDefaultPermissionsForRole } from '@tripbng/shared';

describe('permissions', () => {
  it('SUPER_ADMIN has booking:read:all', () => {
    expect(hasPermission('SUPER_ADMIN', 'booking:read:all')).toBe(true);
  });

  it('AGENCY does not have booking:read:all', () => {
    expect(hasPermission('AGENCY', 'booking:read:all')).toBe(false);
  });

  it('AGENCY has booking:read:own', () => {
    expect(hasPermission('AGENCY', 'booking:read:own')).toBe(true);
  });

  it('deniedPermissions overrides role default', () => {
    expect(hasPermission('SUPER_ADMIN', 'booking:read:all', [], ['booking:read:all'])).toBe(false);
  });

  it('customPermissions extends role default', () => {
    expect(hasPermission('AGENCY', 'booking:read:all', ['booking:read:all'])).toBe(true);
  });

  it('default set for DISTRIBUTOR includes downline reads', () => {
    const perms = getDefaultPermissionsForRole('DISTRIBUTOR');
    expect(perms).toContain('agency:read:downline');
    expect(perms).toContain('booking:read:downline');
  });
});
