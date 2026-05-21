'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { ChevronRight, Paintbrush, Plus } from 'lucide-react';
import type { PublicDistributor } from '@tripbng/shared';
import {
  Badge,
  Button,
  DataTable,
  Input,
  PageHeader,
  Pagination,
  StatusBadge,
} from '@/components/ui';
import { useApiPaginatedQuery } from '@/lib/api-client';
import { CreateDistributorDrawer } from './_create-distributor-drawer';
import { EditDistributorDrawer } from './_edit-distributor-drawer';
import { DownlineDrawer } from './_downline-drawer';

export default function DistributorsPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicDistributor | null>(null);
  const [downlineTarget, setDownlineTarget] = useState<PublicDistributor | null>(null);

  const list = useApiPaginatedQuery<PublicDistributor>(
    ['distributors', { page, q }],
    '/api/v1/distributors',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const columns = useMemo<ColumnDef<PublicDistributor, unknown>[]>(
    () => [
      {
        header: 'Distributor',
        accessorKey: 'companyName',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.companyName}</span>
            <span className="font-mono text-xs text-ink-3">{row.original.distributorCode}</span>
          </div>
        ),
      },
      {
        header: 'Location',
        accessorKey: 'city',
        cell: ({ row }) => (
          <span className="text-sm text-ink-2">
            {row.original.city}, {row.original.state}
          </span>
        ),
      },
      {
        header: 'Override %',
        accessorKey: 'overrideCommissionPercent',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums">
            {(getValue() as number).toFixed(2)}%
          </span>
        ),
      },
      {
        header: 'Agencies',
        accessorKey: 'agencyCount',
        cell: ({ getValue }) => (
          <Badge variant="outline" className="font-mono">
            {getValue() as number}
          </Badge>
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
          <div className="flex justify-end gap-2">
            <Link
              href={`/admin/branding/DISTRIBUTOR/${row.original.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-surface-2 hover:text-brand-700"
              title="Override branding"
              aria-label={`Override branding for ${row.original.companyName}`}
            >
              <Paintbrush className="h-3.5 w-3.5" />
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setDownlineTarget(row.original);
              }}
            >
              View downline <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Channel"
        title="Distributors"
        description="Regional partners who recruit and fund agencies."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New distributor
          </Button>
        }
      />

      <Input
        placeholder="Search by company name or code"
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
        onRowClick={(d) => setEditTarget(d)}
        empty="No distributors yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <CreateDistributorDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EditDistributorDrawer
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
      <DownlineDrawer
        target={downlineTarget}
        onOpenChange={(open) => !open && setDownlineTarget(null)}
      />
    </div>
  );
}
