import { Badge, type BadgeProps } from './badge';

const statusToVariant: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'success',
  CONFIRMED: 'success',
  TICKETED: 'success',
  PAID: 'success',
  PENDING: 'warning',
  PAYMENT_PENDING: 'warning',
  HOLD: 'warning',
  PARTIAL: 'warning',
  CANCEL_REQUESTED: 'warning',
  REFUND_PENDING: 'warning',
  PAUSED: 'warning',
  SUSPENDED: 'danger',
  BLOCKED: 'danger',
  FAILED: 'danger',
  CANCELLED: 'danger',
  DISABLED: 'danger',
  REFUNDED: 'info',
  EXPIRED: 'neutral',
  INITIATED: 'neutral',
  TICKETING_IN_PROGRESS: 'info',
};

// Statuses that represent something *happening* — pulsing dot for visual liveness.
const liveStatuses = new Set(['HOLD', 'TICKETING_IN_PROGRESS', 'PAYMENT_PENDING', 'CANCEL_REQUESTED', 'REFUND_PENDING']);

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const variant = statusToVariant[status] ?? 'neutral';
  const live = liveStatuses.has(status);
  return (
    <Badge variant={variant} dot pulse={live} className={className}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
