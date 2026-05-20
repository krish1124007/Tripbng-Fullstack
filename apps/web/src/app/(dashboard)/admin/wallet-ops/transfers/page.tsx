'use client';

// Admin → Wallet ops → Distributor transfers
//
// Approval queue for distributor → agency wallet transfers that crossed the
// `approvalRequired` threshold (spec §5). Super-admins approve / reject /
// recall here; the state machine on the API side enforces the legal
// transitions (PENDING_APPROVAL → COMPLETED | REJECTED | REVERSED).

import { useState } from 'react';
import { ArrowLeftRight, Check, RotateCcw, Shield, X } from 'lucide-react';
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

type TransferStatus =
  | 'PENDING_APPROVAL'
  | 'COMPLETED'
  | 'REJECTED'
  | 'REVERSED'
  | 'FAILED';

interface DistributorTransfer {
  id: string;
  transferRef: string;
  distributorId: string;
  agencyId: string;
  amountPaise: number;
  type: 'CREDIT' | 'DEBIT';
  status: TransferStatus;
  approvalRequired: boolean;
  createdAt: string;
}

const STATUS_TABS: { value: TransferStatus | 'all'; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'Pending' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REVERSED', label: 'Reversed' },
  { value: 'all', label: 'All' },
];

export default function TransfersAdminPage() {
  const me = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<TransferStatus | 'all'>('PENDING_APPROVAL');
  const [actionTarget, setActionTarget] = useState<
    | { kind: 'approve' | 'reject' | 'recall'; row: DistributorTransfer }
    | null
  >(null);

  const list = useApiQuery<{ items: DistributorTransfer[] }>(
    ['admin', 'transfers', tab],
    '/api/v1/admin/transfers',
    {
      query: tab === 'all' ? { limit: 100 } : { status: tab, limit: 100 },
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  const invalidate = useInvalidateOnSuccess([['admin', 'transfers']]);

  const approve = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/admin/transfers/${input.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Transfer approved — both wallet legs posted');
        setActionTarget(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Approval failed'),
    },
  );

  const reject = useApiMutation<{ id: string; reason: string }, unknown>(
    (input) => `/api/v1/admin/transfers/${input.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Transfer rejected');
        setActionTarget(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Rejection failed'),
    },
  );

  const recall = useApiMutation<{ id: string; notes?: string | null }, unknown>(
    (input) => `/api/v1/admin/transfers/${input.id}/recall`,
    'POST',
    {
      onSuccess: () => {
        invalidate();
        toast.success('Transfer recalled — both wallet legs reversed');
        setActionTarget(null);
      },
      onError: (err) => toast.error(err instanceof ApiCallError ? err.message : 'Recall failed'),
    },
  );

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Distributor transfer approvals are restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Wallet ops"
        title="Distributor transfers"
        description="Distributor → agency wallet transfers that crossed the per-tenant approval threshold. Approve to post both wallet legs, reject to block, or recall a completed transfer to reverse it."
      />

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1">
        {STATUS_TABS.map((t) => {
          const isActive = tab === t.value;
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
            </button>
          );
        })}
      </div>

      {list.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !list.data || list.data.items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ArrowLeftRight}
              title={tab === 'PENDING_APPROVAL' ? 'No pending transfers' : 'No matching transfers'}
              description={
                tab === 'PENDING_APPROVAL'
                  ? 'Distributor transfers below the approval threshold post immediately. Anything that lands here needs a super-admin signature.'
                  : 'Switch tabs above to see other transfer states.'
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.data.items.map((row) => (
            <TransferRow
              key={row.id}
              row={row}
              onApprove={() => setActionTarget({ kind: 'approve', row })}
              onReject={() => setActionTarget({ kind: 'reject', row })}
              onRecall={() => setActionTarget({ kind: 'recall', row })}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={actionTarget?.kind === 'approve'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Approve transfer?"
        description={
          actionTarget ? (
            <span>
              Posts a <strong>{formatPaiseAsINR(actionTarget.row.amountPaise)}</strong>{' '}
              {actionTarget.row.type === 'CREDIT' ? 'credit' : 'debit'} leg on the agency wallet
              and the matching opposite leg on the distributor wallet. Atomic — both succeed or
              both roll back.
            </span>
          ) : null
        }
        confirmLabel="Approve & post"
        onConfirm={() => {
          if (actionTarget) approve.mutate({ id: actionTarget.row.id });
        }}
      />

      <ConfirmDialog
        open={actionTarget?.kind === 'reject'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Reject transfer?"
        description="The proposer is notified, no wallet legs are posted, and the transfer is closed permanently."
        confirmLabel="Reject"
        destructive
        onConfirm={() => {
          if (actionTarget) {
            reject.mutate({ id: actionTarget.row.id, reason: 'Rejected by super-admin' });
          }
        }}
      />

      <ConfirmDialog
        open={actionTarget?.kind === 'recall'}
        onOpenChange={(o) => !o && setActionTarget(null)}
        title="Recall completed transfer?"
        description="Posts both wallet legs in reverse, restoring the original balances. The transfer is marked REVERSED and the original ledger entries stay (with paired reversal entries) for audit."
        confirmLabel="Recall transfer"
        destructive
        onConfirm={() => {
          if (actionTarget) recall.mutate({ id: actionTarget.row.id, notes: null });
        }}
      />
    </div>
  );
}

function TransferRow({
  row,
  onApprove,
  onReject,
  onRecall,
}: {
  row: DistributorTransfer;
  onApprove: () => void;
  onReject: () => void;
  onRecall: () => void;
}) {
  const canApprove = row.status === 'PENDING_APPROVAL';
  // Recall is reserved for completed transfers — pending ones go through reject.
  const canRecall = row.status === 'COMPLETED';

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={row.type === 'CREDIT' ? 'success' : 'danger'} dot>
                {row.type}
              </Badge>
              <span className="text-xl font-bold tabular-nums text-ink-1">
                {formatPaiseAsINR(row.amountPaise)}
              </span>
              <StatusBadge status={row.status} />
              {row.approvalRequired ? (
                <Badge variant="warning">Above threshold</Badge>
              ) : null}
            </div>

            <p className="mt-1 font-mono text-xs text-ink-3">{row.transferRef}</p>

            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-3 sm:grid-cols-3">
              <div>
                <span className="font-semibold text-ink-2">Distributor:</span>
                <div className="font-mono text-[11px]">{row.distributorId}</div>
              </div>
              <div>
                <span className="font-semibold text-ink-2">Agency:</span>
                <div className="font-mono text-[11px]">{row.agencyId}</div>
              </div>
              <div>
                <span className="font-semibold text-ink-2">Created:</span>
                <div>{new Date(row.createdAt).toLocaleString('en-IN')}</div>
              </div>
            </div>
          </div>

          {(canApprove || canRecall) && (
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
                <Button size="sm" variant="ghost" onClick={onRecall}>
                  <RotateCcw className="h-4 w-4" />
                  Recall
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: TransferStatus }) {
  const variant: Record<TransferStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
    PENDING_APPROVAL: 'warning',
    COMPLETED: 'success',
    REJECTED: 'danger',
    REVERSED: 'neutral',
    FAILED: 'danger',
  };
  const label: Record<TransferStatus, string> = {
    PENDING_APPROVAL: 'Pending approval',
    COMPLETED: 'Completed',
    REJECTED: 'Rejected',
    REVERSED: 'Reversed',
    FAILED: 'Failed',
  };
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}
