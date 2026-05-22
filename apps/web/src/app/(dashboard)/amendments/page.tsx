'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ExternalLink, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicAmendment } from '@tripbng/shared';
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
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { formatPaiseAsINR } from '@/lib/money';

export default function AmendmentsPage() {
  const me = useAuthStore((s) => s.user);
  const isOps =
    me?.role === 'SUPER_ADMIN' || me?.role === 'SUPPORT_AGENT' || me?.role === 'ACCOUNTS_USER';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('all');
  const [type, setType] = useState<string>('all');
  const [approveTarget, setApproveTarget] = useState<PublicAmendment | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PublicAmendment | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const list = useApiPaginatedQuery<PublicAmendment>(
    ['amendments', { page, status, type }],
    '/api/v1/amendments',
    {
      query: {
        page,
        limit: 20,
        status: status === 'all' ? undefined : status,
        type: type === 'all' ? undefined : type,
      },
    },
  );

  const invalidate = useInvalidateOnSuccess([['amendments']]);

  const approve = useApiMutation<{ id: string }, PublicAmendment>(
    (i) => `/api/v1/amendments/${i.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Amendment approved & posted');
        invalidate();
        setApproveTarget(null);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const reject = useApiMutation<{ id: string; reason: string }, PublicAmendment>(
    (i) => `/api/v1/amendments/${i.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Amendment rejected');
        invalidate();
        setRejectTarget(null);
        setRejectReason('');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicAmendment, unknown>[]>(
    () => [
      {
        header: 'Code',
        accessorKey: 'amendmentCode',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-xs text-ink-1">{row.original.amendmentCode}</span>
            <Link
              href={`/bookings/${row.original.bookingId}`}
              className="font-mono text-[10px] text-ink-3 hover:text-accent"
            >
              {row.original.bookingCode}
            </Link>
          </div>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        header: 'Reason',
        accessorKey: 'reason',
        cell: ({ getValue }) => (
          <span className="block max-w-[260px] truncate text-sm text-ink-2">{getValue() as string}</span>
        ),
      },
      {
        header: 'Fee',
        accessorKey: 'feePaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(getValue() as number, { compact: true })}
          </span>
        ),
      },
      {
        header: 'Refund',
        accessorKey: 'refundPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums text-success">
            {formatPaiseAsINR(getValue() as number, { compact: true })}
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
          if (!isOps || row.original.status !== 'PENDING_APPROVAL') {
            return (
              <Link
                href={`/bookings/${row.original.bookingId}`}
                className="text-xs text-accent hover:underline"
              >
                View <ExternalLink className="inline h-3 w-3" />
              </Link>
            );
          }
          return (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRejectTarget(row.original)}>
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
              <Button size="sm" onClick={() => setApproveTarget(row.original)}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            </div>
          );
        },
      },
    ],
    [isOps],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title={isOps ? 'Amendment approvals' : 'My amendments'}
        description={
          isOps
            ? 'Cancellations and reschedules awaiting approval. Approving posts refund + fee to the ledger.'
            : 'Your cancellation and reschedule requests.'
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="PENDING_APPROVAL">Pending</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="CANCEL">Cancel</SelectItem>
            <SelectItem value="RESCHEDULE">Reschedule</SelectItem>
            <SelectItem value="REFUND">Refund</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No amendments yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title={`Approve amendment ${approveTarget?.amendmentCode}?`}
        description={`Refund ${formatPaiseAsINR(approveTarget?.refundPaise ?? 0, { compact: true })} will be credited; fee ${formatPaiseAsINR(approveTarget?.feePaise ?? 0, { compact: true })} debited. Two ledger entries posted, irreversible without an admin adjustment.`}
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
            <DialogTitle>Reject amendment</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <p className="text-sm text-ink-3">
              Reason becomes visible to the requesting agency. Their booking returns to its prior state.
            </p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. proof unclear, outside fare-rule window"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectReason.trim().length < 3 || reject.isPending}
              onClick={() => {
                if (rejectTarget)
                  reject.mutate({ id: rejectTarget.id, reason: rejectReason.trim() });
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
