'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicSupplier } from '@tripbng/shared';
import {
  Badge,
  Button,
  DataTable,
  Input,
  PageHeader,
  Pagination,
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { CreateSupplierDrawer } from './_create-supplier-drawer';
import { EditSupplierDrawer } from './_edit-supplier-drawer';
import { LiveIntegrations } from './_live-integrations';

export default function SuppliersPage() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicSupplier | null>(null);

  const list = useApiPaginatedQuery<PublicSupplier>(
    ['suppliers', { page, q }],
    '/api/v1/suppliers',
    { query: { page, limit: 20, q: q || undefined } },
  );

  const invalidate = useInvalidateOnSuccess([['suppliers']]);
  const test = useApiMutation<{ id: string }, { ok: boolean; message: string }>(
    (i) => `/api/v1/suppliers/${i.id}/test-connection`,
    'POST',
    {
      onSuccess: (data) => {
        if (data.ok) toast.success(data.message);
        else toast.error(data.message);
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicSupplier, unknown>[]>(
    () => [
      {
        header: 'Supplier',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-sm text-ink-1">{row.original.name}</span>
            <span className="font-mono text-xs text-ink-3">{row.original.code}</span>
          </div>
        ),
      },
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
      },
      {
        header: 'Products',
        accessorKey: 'productTypes',
        cell: ({ getValue }) => {
          const products = getValue() as string[];
          return (
            <div className="flex gap-1">
              {products.map((p) => (
                <Badge key={p} variant="neutral" className="font-mono text-[10px]">
                  {p}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        header: 'Last health',
        accessorKey: 'lastHealthCheckAt',
        cell: ({ row }) => {
          const v = row.original.lastHealthCheckAt;
          const ok = row.original.lastHealthCheckOk;
          if (!v) return <span className="text-xs text-ink-3">never</span>;
          return (
            <span className={ok ? 'text-xs text-success' : 'text-xs text-danger'}>
              {ok ? 'OK' : 'FAIL'} · {new Date(v).toLocaleTimeString()}
            </span>
          );
        },
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
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                test.mutate({ id: row.original.id });
              }}
              disabled={test.isPending}
            >
              <Wifi className="h-3.5 w-3.5" /> Test
            </Button>
          </div>
        ),
      },
    ],
    [test],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Integration"
        title="Suppliers"
        description="GDS, consolidator, and direct API integrations powering search."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New supplier
          </Button>
        }
      />

      {/* ── Live integrations — env-driven adapters (Kafila, AirIQ, eTrav,
            TBO, SeatSeller, Asego, Mock, Series). Real-time enable/disable +
            health probes. SUPER_ADMIN-only API; the toggle takes effect
            across the API fleet within ~30s. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink-1">Live integrations</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Code-registered adapters powering flights, hotels, bus, holiday, and insurance.
            Toggle off to take a supplier out of fan-out without a deploy.
          </p>
        </div>
        <LiveIntegrations />
      </section>

      {/* ── Custom suppliers — tenant-scoped Mongo rows. Most installs are
            empty; the section stays for partners who maintain bespoke
            connectors outside the platform-shipped adapters. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink-1">Custom suppliers</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Tenant-scoped supplier records — populated when you bring your own connector.
          </p>
        </div>

        <Input
          placeholder="Search by code or name"
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
          onRowClick={(s) => setEditTarget(s)}
          empty="No custom suppliers configured. Built-in adapters above cover most needs."
        />

        <Pagination
          page={page}
          totalPages={list.data?.meta.totalPages ?? 1}
          total={list.data?.meta.total ?? 0}
          onPageChange={setPage}
        />
      </section>

      <CreateSupplierDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EditSupplierDrawer
        target={editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      />
    </div>
  );
}
