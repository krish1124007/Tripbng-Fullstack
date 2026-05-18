// Tenancy guard — Mongoose plugin that auto-injects `tenantId` into every
// query and refuses cross-tenant reads.
//
// Why: the codebase has 30+ models that all carry `tenantId`. Today every
// developer must remember to add `{ tenantId: ctx.tenantId, ... }` to every
// `find/findOne/updateOne/...` call. One miss = cross-tenant data leak. This
// plugin makes it impossible to leak by accident.
//
// How:
//   - On every read/update/delete query, if the request's tenant context is
//     set, the plugin merges `tenantId: <ctx>` into the filter.
//   - If the developer ALREADY set `tenantId` and it doesn't match the
//     context, the plugin throws — early, loud, in dev.
//   - For background jobs / super-admin reads, callers wrap the work in
//     `runWithoutTenant()` (the plugin honours the `bypass` flag).
//
// Apply via `schema.plugin(tenancyGuard)` at model definition time. We register
// it globally in `config/db.ts` so every existing model gets it without
// per-model edits.

import type { Schema } from 'mongoose';
import { getCurrentTenantId, isBypassed } from '../../middleware/tenant-context.js';
import { logger } from '../../config/logger.js';

const READ_OPS = [
  'find',
  'findOne',
  'count',
  'countDocuments',
  'estimatedDocumentCount',
  'distinct',
  'aggregate',
] as const;

const WRITE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
  'replaceOne',
] as const;

const ALL_OPS = [...READ_OPS, ...WRITE_OPS];

/** Models exempt from the guard — top-level entities that legitimately span
 *  tenants (the Tenant model itself, Counters, etc.). Add sparingly. */
const EXEMPT_MODELS = new Set<string>([
  'Tenant',
  'Counter',
  'AuditLog', // we want admins to be able to read across tenants for ops
  'WebhookEvent', // gateway webhooks aren't tenant-scoped at receive time
]);

interface TenancyGuardOptions {
  /** Field name on the model holding the tenant id. Default: `tenantId`. */
  field?: string;
}

export function tenancyGuard(schema: Schema, options: TenancyGuardOptions = {}): void {
  const field = options.field ?? 'tenantId';
  // Only apply to schemas that actually have the field.
  if (!schema.path(field)) return;

  // Hook every query op.
  for (const op of ALL_OPS) {
    schema.pre(op as 'find', function (next) {
      if (isBypassed()) return next();
      const ctx = getCurrentTenantId();
      if (!ctx) {
        // No context = either boot-time query or a job that forgot to set
        // context. We log loudly but don't block — production code paths
        // that need scoping always run inside an authenticated request.
        logger.warn(
          { op, model: this.model?.modelName, stack: new Error().stack?.split('\n').slice(2, 5).join(' | ') },
          'tenancy-guard: query ran without tenant context (allowed but flagged)',
        );
        return next();
      }
      const filter = (this as { getFilter?: () => Record<string, unknown> }).getFilter?.() ?? {};
      const existing = filter[field];
      if (existing !== undefined && String(existing) !== ctx) {
        // The developer explicitly set a different tenantId — reject.
        return next(
          new Error(
            `tenancy-guard: query for ${this.model?.modelName} sets ${field}=${String(existing)} but context tenant is ${ctx}`,
          ),
        );
      }
      if (existing === undefined) {
        // Inject the tenant filter.
        (this as { where: (criteria: Record<string, unknown>) => unknown }).where({
          [field]: ctx,
        });
      }
      return next();
    });
  }
}

/** Apply the guard to every registered model that isn't on the exempt list.
 *  Call once at boot, after all models are defined. */
export function applyTenancyGuardGlobally(mongoose: typeof import('mongoose')): void {
  for (const [name, model] of Object.entries(mongoose.models)) {
    if (EXEMPT_MODELS.has(name)) continue;
    if (model.schema.path('tenantId')) {
      // Idempotent — Mongoose ignores re-application.
      model.schema.plugin(tenancyGuard);
    }
  }
}
