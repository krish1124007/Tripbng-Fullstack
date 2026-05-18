'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicMarkupRule } from '@tripbng/shared';
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
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR, formatPercentBasisPoints } from '@/lib/money';
import { MarkupRuleDrawer } from './_markup-rule-drawer';

export default function MarkupRulesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicMarkupRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicMarkupRule | null>(null);

  const list = useApiPaginatedQuery<PublicMarkupRule>(
    ['markup-rules', { page, q }],
    '/api/v1/markup-rules',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const invalidate = useInvalidateOnSuccess([['markup-rules']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/markup-rules/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Rule deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicMarkupRule, unknown>[]>(
    () => [
      {
        header: 'Rule',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.name}</span>
            {row.original.notes ? (
              <span className="text-xs text-ink-3">{row.original.notes}</span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'Scope',
        accessorKey: 'scope',
        cell: ({ getValue }) => {
          const v = getValue() as string;
          const variant =
            v === 'PLATFORM' ? 'info' : v === 'DISTRIBUTOR' ? 'accent' : 'neutral';
          return <Badge variant={variant}>{v}</Badge>;
        },
      },
      {
        header: 'Value',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {row.original.valueType === 'FLAT'
              ? formatPaiseAsINR(row.original.value, { compact: true })
              : formatPercentBasisPoints(row.original.value)}
            {row.original.maxValuePaise != null
              ? ` (cap ${formatPaiseAsINR(row.original.maxValuePaise, { compact: true })})`
              : ''}
          </span>
        ),
      },
      {
        header: 'Conditions',
        cell: ({ row }) => {
          const c = row.original.conditions ?? {};
          const tags: string[] = [];
          if (c.airlines && c.airlines.length > 0) tags.push(`AL: ${c.airlines.join(',')}`);
          if (c.travelType) tags.push(c.travelType);
          if (c.travelClass) tags.push(c.travelClass);
          if (c.paxTypes && c.paxTypes.length > 0) tags.push(c.paxTypes.join(','));
          if (c.origins && c.origins.length > 0) tags.push(`O: ${c.origins.join(',')}`);
          if (c.destinations && c.destinations.length > 0)
            tags.push(`D: ${c.destinations.join(',')}`);
          if (tags.length === 0) return <span className="text-xs text-ink-3">All</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline" className="font-mono text-[10px]">
                  {t}
                </Badge>
              ))}
              {tags.length > 3 ? (
                <span className="text-xs text-ink-3">+{tags.length - 3}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        header: 'Priority',
        accessorKey: 'priority',
        cell: ({ getValue }) => (
          <span className="font-mono text-xs tabular-nums text-ink-2">{getValue() as number}</span>
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
        title="Markup rules"
        description="Visual conditions stack on top of policy. Lowest priority wins per scope."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New rule
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
        empty="No markup rules yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <MarkupRuleDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <MarkupRuleDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete rule "${deleteTarget?.name}"?`}
        description="This is immediate and cannot be undone. Pricing for new bookings will recompute without it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}
