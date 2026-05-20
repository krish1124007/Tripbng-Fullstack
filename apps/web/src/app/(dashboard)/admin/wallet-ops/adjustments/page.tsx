'use client';

// Admin → Wallet ops → Adjustments
//
// Two-person approval surface for manual wallet adjustments (spec §7):
//   • Propose a credit/debit against an agency or distributor wallet
//   • Approve / reject pending requests (must be a different admin than the
//     proposer — the API enforces this)
//   • Cancel your own pending request before it's actioned
//
// SUPER_ADMIN only. The list is filtered server-side by status; we keep the
// UI tabs in sync with the same enum the API takes.

import { useMemo, useState } from 'react';
import { Check, Plus, Shield, Wallet2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { CreateAdjustmentDialog } from './_create-adjustment-dialog';

type AdjustmentStatus = 'PENDING_APPROVAL' | 'EXECUTED' | 'REJECTED' | 'CANCELLED';

interface PendingAdjustment {
  id: string;
  agencyId: string | null;
  distributorId: string | null;
  direction: 'CREDIT' | 'DEBIT';
  amountPaise: number;
  reason: string;
  status: AdjustmentStatus;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  ledgerTxnId: string | null;
}

const STATUS_TABS: { value: AdjustmentStatus | 'all'; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: 'EXECUTED', label: 'Executed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

export default function AdjustmentsAdminPage() {
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<AdjustmentStatus | 'all'>('PENDING_APPROVAL');
  const [createOpen, setCreateOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<
    | { kind: 'approve' | 'reject' | 'cancel'; row: PendingAdjustment }
    | null
  >(null);

  const list = useApiQuery<{ items: PendingAdjustment[] }>(
    ['admin', 'adjustments', tab],
    '/api/v1/admin/adjustments',
    {
      query: tab === 'all' ? { limit: 100 } : { status: tab, limit: 100 },
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  const invalidate = useInvalidateOnSuccess([['admin', 'adjustments']]);

  const approve = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/admin/adjustments/${input.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Adjustment approved and executed');
        setActionTarget(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Approval failed'),
    },
  );

  const reject = useApiMutation<{ id: string; reason: string }, unknown>(
    (input) => `/api/v1/admin/adjustments/${input.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Adjustment rejected');
        setActionTarget(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Rejection failed'),
    },
  );

  const cancel = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/admin/adjustments/${input.id}/cancel`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Adjustment cancelled');
        setActionTarget(null);
      },
      onError: (err) =>
        toast.error(err instanceof ApiCallError ? err.message : 'Cancellation failed'),
    },
  );

  const counts = useMemo(() => {
    const items = list.data?.items ?? [];
    const c: Record<AdjustmentStatus, number> = {
      PENDING_APPROVAL: 0,
      EXECUTED: 0,
      REJECTED: 0,
      CANCELLED: 0,
    };
    for (const i of items) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [list.data]);

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Wallet adjustments are restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Wallet ops"
        title="Wallet adjustments"
        description="Manual credits and debits with two-person approval. Above the configured threshold, every request needs a second admin to approve before the ledger is touched."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Propose adjustment
          </Button>
        }
      />

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((t) => {
          const isActive = tab === t.value;
          const showCount = t.value !== 'all' && counts[t.value as AdjustmentStatus] > 0;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                isActive
                  ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
              )}
            >
              {t.label}
              {showCount ? (
                <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-mono tabular-nums text-ink-3">
                  {counts[t.value as AdjustmentStatus]}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* List */}
      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : !list.data || list.data.items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Wallet2}
              title={tab === 'PENDING_APPROVAL' ? 'No pending adjustments' : 'No matching adjustments'}
              description={
                tab === 'PENDING_APPROVAL'
                  ? 'When an admin proposes a wallet adjustment above the threshold, it shows up here for a second admin to approve.'
                  : 'Switch tabs above to see other adjustment states.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((row) => (
            <AdjustmentRow
              key={row.id}
              row={row}
              currentUserId={me!.id}
              onApprove={() => setActionTarget({ kind: 'approve', row })}
              onReject={() => setActionTarget({ kind: 'reject', row })}
              onCancel={() => setActionTarget({ kind: 'cancel', row })}
            />
          ))}
        </div>
      )}

      <CreateAdjustmentDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Action confirms — single shared dialog driven by actionTarget */}
      <ConfirmDialog
        open={actionTarget?.kind === 'approve'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Approve adjustment?"
        description={
          actionTarget ? (
            <span>
              Approving will execute a{' '}
              <strong>
                {actionTarget.row.direction === 'CREDIT' ? 'credit of ' : 'debit of '}
                {formatPaiseAsINR(actionTarget.row.amountPaise)}
              </strong>{' '}
              against the target wallet. This writes to the ledger and cannot be undone — only
              reversed via another adjustment.
            </span>
          ) : null
        }
        confirmLabel="Approve & execute"
        onConfirm={() => {
          if (actionTarget) approve.mutate({ id: actionTarget.row.id });
        }}
      />

      <ConfirmDialog
        open={actionTarget?.kind === 'reject'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Reject adjustment?"
        description="The proposer is notified and the ledger is not touched. The proposer can submit a fresh request afterwards."
        confirmLabel="Reject"
        destructive
        onConfirm={() => {
          if (actionTarget) reject.mutate({ id: actionTarget.row.id, reason: 'Rejected by admin' });
        }}
      />

      <ConfirmDialog
        open={actionTarget?.kind === 'cancel'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Cancel your request?"
        description="Withdraws this pending request. No effect on the ledger."
        confirmLabel="Cancel request"
        destructive
        onConfirm={() => {
          if (actionTarget) cancel.mutate({ id: actionTarget.row.id });
        }}
      />
    </div>
  );
}

function AdjustmentRow({
  row,
  currentUserId,
  onApprove,
  onReject,
  onCancel,
}: {
  row: PendingAdjustment;
  currentUserId: string;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const isProposer = row.proposedBy === currentUserId;
  const canApprove = row.status === 'PENDING_APPROVAL' && !isProposer;
  const canCancel = row.status === 'PENDING_APPROVAL' && isProposer;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={row.direction === 'CREDIT' ? 'success' : 'danger'} dot>
                {row.direction}
              </Badge>
              <span className="text-xl font-bold tabular-nums text-ink-1">
                {formatPaiseAsINR(row.amountPaise)}
              </span>
              <StatusBadge status={row.status} />
            </div>

            <p className="mt-2 text-sm text-ink-2">{row.reason}</p>

            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-3 sm:grid-cols-4">
              <div>
                <span className="font-semibold text-ink-2">Target:</span>{' '}
                {row.agencyId ? 'Agency' : 'Distributor'}
                <div className="font-mono text-[11px]">{row.agencyId ?? row.distributorId}</div>
              </div>
              <div>
                <span className="font-semibold text-ink-2">Proposed:</span>
                <div>{new Date(row.proposedAt).toLocaleString('en-IN')}</div>
              </div>
              <div>
                <span className="font-semibold text-ink-2">Proposer:</span>
                <div className="font-mono text-[11px]">
                  {row.proposedBy.slice(-6)}
                  {isProposer ? ' (you)' : ''}
                </div>
              </div>
              {row.approvedAt ? (
                <div>
                  <span className="font-semibold text-ink-2">
                    {row.status === 'REJECTED' ? 'Rejected' : 'Approved'}:
                  </span>
                  <div>{new Date(row.approvedAt).toLocaleString('en-IN')}</div>
                </div>
              ) : null}
            </div>

            {row.rejectionReason ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger/5 p-2 text-xs text-danger">
                <span className="font-semibold">Rejection reason:</span> {row.rejectionReason}
              </p>
            ) : null}
          </div>

          {(canApprove || canCancel) && (
            <div className="flex shrink-0 gap-2">
              {canApprove ? (
                <>
                  <Button size="sm" variant="ghost" onClick={onReject}>
                    <X className="h-4 w-4" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={onApprove}>
                    <Check className="h-4 w-4" />
                    Approve
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  Cancel my request
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: AdjustmentStatus }) {
  const variant: Record<AdjustmentStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
    PENDING_APPROVAL: 'warning',
    EXECUTED: 'success',
    REJECTED: 'danger',
    CANCELLED: 'neutral',
  };
  const label: Record<AdjustmentStatus, string> = {
    PENDING_APPROVAL: 'Pending approval',
    EXECUTED: 'Executed',
    REJECTED: 'Rejected',
    CANCELLED: 'Cancelled',
  };
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}
