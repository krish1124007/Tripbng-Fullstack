'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Calendar, Copy, MoreHorizontal, Pause, Play, Plus } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { PublicInventory } from '@tripbng/shared';
import {
  Badge,
  Button,
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
import { formatPaiseAsINR } from '@/lib/money';
import { CreateInventoryWizard } from './_create-inventory-wizard';
import { EditInventoryDrawer } from './_edit-inventory-drawer';

export default function InventoriesPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicInventory | null>(null);

  const list = useApiPaginatedQuery<PublicInventory>(
    ['inventories', { page, q }],
    '/api/v1/inventories',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const invalidate = useInvalidateOnSuccess([['inventories']]);

  const togglePause = useApiMutation<{ id: string }, PublicInventory>(
    (i) => `/api/v1/inventories/${i.id}/pause`,
    'POST',
    {
      onSuccess: (data) => {
        toast.success(data.status === 'PAUSED' ? 'Inventory paused' : 'Inventory resumed');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const clone = useApiMutation<{ id: string }, PublicInventory>(
    (i) => `/api/v1/inventories/${i.id}/clone`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Cloned to draft');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicInventory, unknown>[]>(
    () => [
      {
        header: 'Inventory',
        accessorKey: 'inventoryName',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.inventoryName}</span>
            <span className="font-mono text-xs text-ink-3">{row.original.inventoryCode}</span>
          </div>
        ),
      },
      {
        header: 'Sector',
        cell: ({ row }) => (
          <span className="font-mono text-sm text-ink-2">
            {row.original.origin.code} → {row.original.destination.code}
          </span>
        ),
      },
      {
        header: 'Series',
        cell: ({ row }) => (
          <span className="text-xs text-ink-3 tabular-nums">
            {new Date(row.original.seriesStartDate).toLocaleDateString('en-IN', {
              month: 'short',
              day: 'numeric',
            })}
            {' → '}
            {new Date(row.original.seriesEndDate).toLocaleDateString('en-IN', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        ),
      },
      {
        header: 'Adult fare',
        accessorKey: 'fare.adultFare',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(row.original.fare.adultFare, { compact: true })}
          </span>
        ),
      },
      {
        header: 'Seats',
        cell: ({ row }) => {
          const pct = (row.original.seatsRemaining / row.original.totalSeats) * 100;
          const tone =
            pct < 10
              ? 'danger'
              : pct < 30
                ? 'warning'
                : 'success';
          return (
            <Badge variant={tone}>
              {row.original.seatsRemaining}/{row.original.totalSeats}
            </Badge>
          );
        },
      },
      {
        header: 'Type',
        accessorKey: 'travelType',
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
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
              <DropdownMenuContent align="end" className="w-48">
                {row.original.status === 'PAUSED' ? (
                  <DropdownMenuItem onClick={() => togglePause.mutate({ id: row.original.id })}>
                    <Play className="h-4 w-4" /> Resume
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => togglePause.mutate({ id: row.original.id })}>
                    <Pause className="h-4 w-4" /> Pause
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => clone.mutate({ id: row.original.id })}>
                  <Copy className="h-4 w-4" /> Clone to draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [togglePause, clone],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Series"
        title="Inventory"
        description="Bulk-held series fares — the crown jewel of your distribution."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" asChild>
              <Link href="/inventories/calendar">
                <Calendar className="h-4 w-4" /> Calendar view
              </Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New inventory
            </Button>
          </div>
        }
      />

      <Input
        placeholder="Search by name, code, or sector"
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
        onRowClick={(inv) => setEditTarget(inv)}
        empty="No inventories yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <CreateInventoryWizard open={createOpen} onOpenChange={setCreateOpen} />
      <EditInventoryDrawer
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
    </div>
  );
}
