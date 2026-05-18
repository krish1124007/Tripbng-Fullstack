'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicFareRule } from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  PageHeader,
  Pagination,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { FareRuleDrawer } from './_fare-rule-drawer';

export default function FareRulesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicFareRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicFareRule | null>(null);

  const list = useApiPaginatedQuery<PublicFareRule>(
    ['fare-rules', { page, q }],
    '/api/v1/fare-rules',
    { query: { page, limit: 20, q: q || undefined } },
  );
  const invalidate = useInvalidateOnSuccess([['fare-rules']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/fare-rules/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Fare rule deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicFareRule, unknown>[]>(
    () => [
      {
        header: 'Name',
        accessorKey: 'name',
        cell: ({ getValue }) => <span className="text-sm text-ink-1">{getValue() as string}</span>,
      },
      {
        header: 'Cancellation bands',
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.cancellationBands.length} bands</Badge>
        ),
      },
      {
        header: 'Reschedule bands',
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.reschedulingBands.length} bands</Badge>
        ),
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Row actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditTarget(row.original)}>Edit</DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => setDeleteTarget(row.original)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pricing"
        title="Fare rules"
        description="Cancellation, reschedule, and no-show fees by hours-before-departure band."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New fare rule
          </Button>
        }
      />

      <Input
        placeholder="Search by name"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        className="max-w-sm"
      />

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No fare rules yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <FareRuleDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <FareRuleDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This won't affect existing bookings already issued under this rule, but new bookings won't see it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}
