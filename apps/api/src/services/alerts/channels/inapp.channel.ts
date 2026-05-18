// In-app channel — writes to the existing Notification model via the
// notification.service emit() helper. Skipped silently when the recipient
// has no userId (e.g. raw email-only recipient).
//
// Categorization: ALERT for failures + warnings, TRANSACTIONAL for
// successes. Drives unread-badge UX.

import type { NotificationCategory } from '@tripbng/shared';
import { emit } from '../../notification.service.js';
import type { AlertEvent, RenderedInApp, ResolvedRecipient } from '../types.js';

export interface InAppSendResult {
  status: 'sent' | 'skipped' | 'failed';
  notificationId?: string | null;
  reason?: string;
}

export async function sendInApp(
  recipient: ResolvedRecipient,
  rendered: RenderedInApp,
  ctx: { tenantId: string; event: AlertEvent },
): Promise<InAppSendResult> {
  if (!recipient.userId) {
    return { status: 'skipped', reason: 'no recipient userId for in-app channel' };
  }

  try {
    const doc = await emit({
      tenantId: ctx.tenantId,
      userId: recipient.userId,
      agencyId: recipient.agencyId ?? null,
      category: categoryFor(ctx.event),
      channel: 'IN_APP',
      priority: priorityFor(ctx.event),
      title: rendered.title,
      body: rendered.body,
      href: rendered.actionUrl ?? null,
      metadata: { event: ctx.event, type: rendered.type ?? null },
    });
    return { status: 'sent', notificationId: String(doc._id) };
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'in-app emit failed',
    };
  }
}

function categoryFor(event: AlertEvent): NotificationCategory {
  switch (event) {
    case 'BOOKING_FAILED':
    case 'TOPUP_FAILED':
    case 'HOLD_EXPIRY_WARNING':
    case 'LOW_WALLET_BALANCE':
    case 'CIRCUIT_BREAKER_TRIPPED':
    case 'LOGIN_NEW_DEVICE':
    case 'MANUAL_TOPUP_REJECTED':
      return 'ALERT';
    case 'BOOKING_CONFIRMED':
    case 'BOOKING_CANCELLED':
    case 'TOPUP_SUCCEEDED':
    case 'INSURANCE_ISSUED':
      return 'TRANSACTIONAL';
    case 'MANUAL_TOPUP_APPROVED':
    case 'PASSWORD_RESET_OTP':
      return 'OPERATIONAL';
    default:
      return 'TRANSACTIONAL';
  }
}

function priorityFor(event: AlertEvent): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
  switch (event) {
    case 'BOOKING_FAILED':
    case 'CIRCUIT_BREAKER_TRIPPED':
      return 'URGENT';
    case 'HOLD_EXPIRY_WARNING':
    case 'LOW_WALLET_BALANCE':
    case 'TOPUP_FAILED':
    case 'LOGIN_NEW_DEVICE':
      return 'HIGH';
    default:
      return 'NORMAL';
  }
}
