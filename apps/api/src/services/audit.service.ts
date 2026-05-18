import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

export interface AuditEvent {
  tenantId: string;
  actorId?: string | null;
  actorRole?: string | null;
  impersonatorId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  success?: boolean;
  error?: string | null;
}

export async function recordAudit(event: AuditEvent): Promise<void> {
  try {
    await AuditLog.create({
      ...event,
      success: event.success ?? true,
    });
  } catch (err) {
    // Audit failures must never break the request — but we shout loud about them.
    logger.error({ err, event }, 'failed to write audit log');
  }
}
