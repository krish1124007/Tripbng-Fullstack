'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Paintbrush, Plus } from 'lucide-react';
import type { PublicAgency, PublicDistributor } from '@tripbng/shared';
import {
  Badge,
  Button,
  DataTable,
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
import { useApiPaginatedQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { CreateAgencyDrawer } from './_create-agency-drawer';
import { EditAgencyDrawer } from './_edit-agency-drawer';

function formatINR(paise: number): string {
  // Currency stored as paise per spec §19. Display as ₹.
  const rupees = paise / 100;
  return rupees.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

export default function AgenciesPage() {
  const me = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [distributorFilter, setDistributorFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicAgency | null>(null);

  const list = useApiPaginatedQuery<PublicAgency>(
    ['agencies', { page, q, distributorFilter }],
    '/api/v1/agencies',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const distributors = useApiPaginatedQuery<PublicDistributor>(
    ['distributors-for-filter'],
    '/api/v1/distributors',
    { query: { limit: 200 }, enabled: me?.role === 'SUPER_ADMIN' },
  );

  const filtered =
    distributorFilter === 'all'
      ? list.data?.data
      : (list.data?.data ?? []).filter((a) => a.distributorId === distributorFilter);

  const columns = useMemo<ColumnDef<PublicAgency, unknown>[]>(
    () => [
      {
        header: 'Agency',
        accessorKey: 'companyName',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.companyName}</span>
            <span className="font-mono text-xs text-ink-3">{row.original.agencyCode}</span>
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
        header: 'Distributor',
        accessorKey: 'distributorId',
        cell: ({ getValue }) => {
          const v = getValue() as string | null;
          return v ? <Badge variant="outline">{v.slice(-6)}</Badge> : <span className="text-xs text-ink-3">Direct</span>;
        },
      },
      {
        header: 'Wallet',
        accessorKey: 'walletBalance',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums">{formatINR(getValue() as number)}</span>
        ),
      },
      {
        header: 'Credit',
        accessorKey: 'creditLimit',
        cell: ({ row }) => (
          <span className="font-mono text-xs text-ink-3 tabular-nums">
            {formatINR(row.original.outstandingAmount)} / {formatINR(row.original.creditLimit)}
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
        cell: ({ row }) => (
          // Stop propagation so clicking the icon doesn't ALSO fire
          // the row click which opens the edit drawer.
          <div onClick={(e) => e.stopPropagation()}>
            <Link
              href={`/admin/branding/AGENCY/${row.original.id}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-4 transition-colors hover:bg-surface-2 hover:text-brand-700"
              title="Override branding"
              aria-label={`Override branding for ${row.original.companyName}`}
            >
              <Paintbrush className="h-3.5 w-3.5" />
            </Link>
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
        title="Agencies"
        description="Travel agents who search, book, and ticket for end-travelers."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New agency
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search company or code"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="max-w-sm"
        />
        {me?.role === 'SUPER_ADMIN' ? (
          <Select value={distributorFilter} onValueChange={setDistributorFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All distributors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All distributors</SelectItem>
              {distributors.data?.data.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        data={filtered ?? []}
        loading={list.isLoading}
        onRowClick={(a) => setEditTarget(a)}
        empty="No agencies yet."
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={list.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <CreateAgencyDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EditAgencyDrawer
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
    </div>
  );
}
