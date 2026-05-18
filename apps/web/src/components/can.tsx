'use client';

import type { ReactNode } from 'react';
import type { Permission } from '@tripbng/shared';
import { useHasPermission } from '@/lib/rbac';

interface CanProps {
  permission: Permission;
  fallback?: ReactNode;
  children: ReactNode;
}

// Hides UI for users without the permission. Server still re-checks on every API call.
export function Can({ permission, fallback = null, children }: CanProps) {
  const allowed = useHasPermission(permission);
  return <>{allowed ? children : fallback}</>;
}
