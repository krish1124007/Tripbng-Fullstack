import type { Permission } from '@tripbng/shared';
import { hasPermission as sharedHasPermission, type Role } from '@tripbng/shared';
import { useAuthStore } from './auth-store';

export function useHasPermission(permission: Permission): boolean {
  const user = useAuthStore((s) => s.user);
  if (!user) return false;
  // The server-issued permissions[] is the source of truth (already accounts for custom/denied).
  if (user.permissions.includes(permission)) return true;
  // Defensive fallback if permissions[] is missing for some reason.
  return sharedHasPermission(user.role as Role, permission);
}
