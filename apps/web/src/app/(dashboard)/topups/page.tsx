'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ExternalLink, Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicTopupRequest } from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { useAuthStore } from '@/lib/auth-store';

export default function TopupsPage() {
  const me = useAuthStore((s) => s.user);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>(
    'PENDING',
  );
  const [approveTarget, setApproveTarget] = useState<PublicTopupRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PublicTopupRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const list = useApiQuery<PublicTopupRequest[]>(
    ['topups', { statusFilter }],
    '/api/v1/wallet/topups',
    {
      query: { status: statusFilter === 'all' ? undefined : statusFilter },
    },
  );

  const invalidate = useInvalidateOnSuccess([['topups'], ['wallet']]);

  const approve = useApiMutation<{ id: string }, PublicTopupRequest>(
    (i) => `/api/v1/wallet/topups/${i.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Top-up approved & posted to ledger');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const reject = useApiMutation<{ id: string; reason: string }, PublicTopupRequest>(
    (i) => `/api/v1/wallet/topups/${i.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Top-up rejected');
        invalidate();
        setRejectReason('');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const isAdmin = me?.role === 'SUPER_ADMIN' || me?.role === 'ACCOUNTS_USER';

  const columns = useMemo<ColumnDef<PublicTopupRequest, unknown>[]>(
    () => [
      {
        header: 'Date',
        accessorKey: 'createdAt',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-ink-2 tabular-nums">
            {new Date(getValue() as string).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        ),
      },
      {
        header: 'Account',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">
              {row.original.agencyName ?? row.original.distributorName}
            </span>
            <span className="font-mono text-xs text-ink-3">
              {row.original.agencyCode ?? row.original.distributorCode}
            </span>
          </div>
        ),
      },
      {
        header: 'Mode',
        accessorKey: 'paymentMode',
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        header: 'Reference',
        accessorKey: 'referenceNumber',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-ink-3">
            {row.original.referenceNumber ?? '—'}
          </span>
        ),
      },
      {
        header: 'Amount',
        accessorKey: 'amountPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(getValue() as number)}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => {
          if (row.original.status !== 'PENDING' || !isAdmin) {
            return row.original.proofUrl ? (
              <a
                href={row.original.proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Proof <ExternalLink className="inline h-3 w-3" />
              </a>
            ) : null;
          }
          return (
            <div className="flex justify-end gap-2">
              {row.original.proofUrl ? (
                <a
                  href={row.original.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border bg-surface-2 px-2 py-1 text-xs text-ink-2 hover:bg-surface-1"
                >
                  Proof
                </a>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setRejectTarget(row.original);
                }}
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setApproveTarget(row.original);
                }}
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            </div>
          );
        },
      },
    ],
    [isAdmin],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title={isAdmin ? 'Top-up approvals' : 'Top-up history'}
        description={
          isAdmin
            ? 'Manual top-ups awaiting verification. Approving posts an immutable ledger credit.'
            : 'Your past top-up requests. Gateway top-ups clear instantly; manual modes wait on admin.'
        }
      />

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(list.data ?? []).length === 0 && !list.isLoading ? (
        <EmptyState
          icon={Inbox}
          title="No top-ups in this view"
          description="Once a manual top-up is requested, it'll appear here for approval."
        />
      ) : (
        <DataTable
          columns={columns}
          data={list.data ?? []}
          loading={list.isLoading}
          density="compact"
        />
      )}

      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title={`Approve top-up of ${approveTarget ? formatPaiseAsINR(approveTarget.amountPaise) : ''}?`}
        description="The wallet will be credited and an immutable ledger entry posted. This cannot be reversed except by an admin adjustment."
        confirmLabel="Approve & post"
        onConfirm={async () => {
          if (approveTarget) await approve.mutateAsync({ id: approveTarget.id });
        }}
      />

      <Dialog
        open={!!rejectTarget}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject top-up</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-ink-3">
              Provide a reason — the requester will see it in their history.
            </p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. proof unclear, amount mismatch"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectReason.trim().length < 3 || reject.isPending}
              onClick={async () => {
                if (rejectTarget) {
                  await reject.mutateAsync({ id: rejectTarget.id, reason: rejectReason.trim() });
                  setRejectTarget(null);
                }
              }}
            >
              {reject.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
