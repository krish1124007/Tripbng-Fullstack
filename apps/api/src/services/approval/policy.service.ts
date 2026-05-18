// Travel-policy resolution helpers.
//
// One responsibility: given an employeeId, return the TravelPolicy that
// applies. Resolution priority (CLAUDE.md §10 + §5.4):
//
//   1. Employee.travelPolicyId  — explicit per-employee override
//   2. (future) Tenant.settings.defaultTravelPolicyId — fallback
//   3. null — permissive (no checks fire)
//
// The TravelPolicy model has `status='ACTIVE'` filtering — INACTIVE
// policies are excluded from resolution but still readable in the
// admin UI.

import type { Types } from 'mongoose';
import { Employee } from '../../models/Employee.js';
import { TravelPolicy, type TravelPolicyDoc } from '../../models/TravelPolicy.js';

/**
 * Resolve the TravelPolicy applicable to a given employee. Returns null
 * when no policy is wired up — caller treats that as permissive.
 */
export async function resolvePolicyForEmployee(
  employeeId: Types.ObjectId | string,
): Promise<TravelPolicyDoc | null> {
  const employee = await Employee.findById(employeeId)
    .select({ travelPolicyId: 1, tenantId: 1 })
    .lean();
  if (!employee) return null;

  if (employee.travelPolicyId) {
    const explicit = await TravelPolicy.findOne({
      _id: employee.travelPolicyId,
      tenantId: employee.tenantId,
      status: 'ACTIVE',
    });
    if (explicit) return explicit;
  }

  // Tenant default — placeholder hook for the next phase. We don't load
  // the Tenant doc here yet because the field hasn't been added; calling
  // sites that want a tenant default can layer it later.
  return null;
}
