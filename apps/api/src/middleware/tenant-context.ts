// Tenant context — request-scoped store for the caller's tenantId, used by
// the Mongoose tenancy-guard plugin to enforce per-query tenant scoping
// without making developers remember to pass `tenantId` to every `find()`.
//
// The plugin (see `models/plugins/tenancy-guard.ts`) reads this context in
// pre-find hooks; the middleware here populates it from `req.auth.tenantId`
// once authentication has run.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface TenantContext {
  tenantId: string;
  /** Escape hatch — set by callers that legitimately need cross-tenant
   *  reads (super-admin, reconciliation crons, scheduled jobs). The guard
   *  plugin honours this flag and skips its enforcement when set. */
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Express middleware — call AFTER `authenticate + requireAuth`. */
export function tenantContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.tenantId) {
    // No auth = no context. The guard plugin will refuse cross-tenant queries
    // when context is missing — caller must opt out via runWithoutTenant().
    return next();
  }
  storage.run({ tenantId: req.auth.tenantId, bypass: false }, () => next());
}

/** Read current tenant id (or null if no context — e.g. boot-time queries). */
export function getCurrentTenantId(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

export function isBypassed(): boolean {
  return storage.getStore()?.bypass ?? false;
}

/** Run a function with NO tenant scoping. Use sparingly — only for
 *  super-admin reads, reconciliation crons, and scheduled background jobs.
 *  Every call site must justify itself in a comment. */
export function runWithoutTenant<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ tenantId: '', bypass: true }, fn);
}

/** Run with a specific tenantId — for crons that iterate per-tenant. */
export function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ tenantId, bypass: false }, fn);
}
