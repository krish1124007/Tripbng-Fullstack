'use client';

import { useAuthStore } from '@/lib/auth-store';
import { AdminDashboard } from './_admin-dashboard';
import { AgencyDashboard } from './_agency-dashboard';
import { DistributorCockpit } from './_distributor-cockpit';

/**
 * Dashboard router — picks the right cockpit for the signed-in user's role.
 * SUPER_ADMIN → platform overview · DISTRIBUTOR → cockpit · AGENCY/SUB_AGENT → agency dashboard.
 * Anything else falls back to the agency dashboard (book + wallet + recent).
 */
export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  switch (user.role) {
    case 'SUPER_ADMIN':
      return <AdminDashboard />;
    case 'DISTRIBUTOR':
      // Distributor cockpit needs the distributor _id off the user. The schema stores it
      // on the user as `distributorId` for this role.
      return <DistributorCockpit distributorId={user.distributorId ?? ''} />;
    case 'AGENCY':
    case 'SUB_AGENT':
    default:
      return <AgencyDashboard />;
  }
}
