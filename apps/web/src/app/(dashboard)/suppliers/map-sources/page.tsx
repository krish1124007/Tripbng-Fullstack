'use client';

// Map Source list page — the "Manage Supplier → Map Source" screen from the
// admin panel spec. Filters at the top (status / product type / travel type /
// supplier / text search) → data table → row actions for edit + status toggle
// + delete. The form drawer lives in `_map-source-form-drawer.tsx`.

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicSupplierSource } from '@tripbng/shared';
import {
  Button,
  DataTable,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  Switch,
} from '@/components/ui';
import {
  useApiMutation,
  useApiQuery,
  useInvalidateOnSuccess,
} from '@/lib/api-client';
import { MapSourceFormDrawer } from './_map-source-form-drawer';

type StatusFilter = '' | 'ACTIVE' | 'INACTIVE';
type TravelFilter = '' | 'DOMESTIC' | 'INTERNATIONAL' | 'BOTH';
type ProductFilter = '' | 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';

export default function MapSourcesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [travelType, setTravelType] = useState<TravelFilter>('');
  const [productType, setProductType] = useState<ProductFilter>('FLIGHT');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicSupplierSource | null>(null);

  // Build the query payload only with values the API expects. Empty-string
  // sentinels stay client-side.
  const query = useMemo(() => {
    const out: Record<string, string> = {};
    if (q) out.q = q;
    if (status) out.status = status;
    if (travelType) out.travelType = travelType;
    if (productType) out.productType = productType;
    return out;
  }, [q, status, travelType, productType]);

  const list = useApiQuery<PublicSupplierSource[]>(
    ['map-sources', query],
    '/api/v1/suppliers/sources',
    { query },
  );

  const invalidate = useInvalidateOnSuccess([['map-sources']]);
  const update = useApiMutation<
    { id: string; status: 'ACTIVE' | 'INACTIVE' },
    { id: string }
  >((i) => `/api/v1/suppliers/sources/${i.id}`, 'PATCH', {
    onSuccess: () => {
      toast.success('Map Source updated');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useApiMutation<{ id: string }, { ok: boolean }>(
    (i) => `/api/v1/suppliers/sources/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Map Source deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicSupplierSource, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Source Name',
        cell: ({ row }) => {
          const row_ = row.original;
          // Some legacy rows have no name — render a derived label so the
          // table doesn't have a hole. Click-through opens the edit form.
          const label =
            row_.name ??
            `${row_.supplierName ?? row_.supplierCode ?? 'Supplier'} ${row_.travelType}`;
          return (
            <button
              type="button"
              className="font-medium text-accent hover:underline"
              onClick={() => setEditTarget(row_)}
            >
              {label}
            </button>
          );
        },
      },
      {
        accessorKey: 'airlineCodes',
        header: 'Airline Name',
        cell: ({ row }) => {
          const codes = row.original.airlineCodes;
          if (!codes.length) return <span className="text-ink-3">—</span>;
          // Mirror the spec: render the first 4 codes inline, summarise the
          // rest as "+N more" so the cell doesn't sprawl.
          const head = codes.slice(0, 4).join(', ');
          const more = codes.length > 4 ? ` +${codes.length - 4} more` : '';
          return <span className="text-ink-2">{head + more}</span>;
        },
      },
      {
        accessorKey: 'supplierGroup',
        header: 'Supplier Group',
        cell: ({ row }) => (
          <span className="text-ink-2">{row.original.supplierGroup ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Switch
              checked={row.original.status === 'ACTIVE'}
              onCheckedChange={(checked) =>
                update.mutate({
                  id: row.original.id,
                  status: checked ? 'ACTIVE' : 'INACTIVE',
                })
              }
              aria-label="Toggle status"
            />
            <StatusBadge status={row.original.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'} />
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setEditTarget(row.original)}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-danger hover:underline"
              onClick={() => {
                if (
                  // eslint-disable-next-line no-alert
                  window.confirm(
                    `Delete Map Source "${row.original.name ?? row.original.supplierName}"? This cannot be undone.`,
                  )
                ) {
                  remove.mutate({ id: row.original.id });
                }
              }}
            >
              Delete
            </button>
          </div>
        ),
      },
    ],
    [update, remove],
  );

  return (
    <div className="space-y-4 p-6">
      <PageHeader
        title="Map Source"
        description="Manage Supplier  ›  Map Source — control which airlines + fare types from each supplier reach your agents."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Add new
          </Button>
        }
      />

      {/* Filter card matches the spec layout: 4-column grid + search button on the right. */}
      <div className="rounded-md border border-border bg-surface-1 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-ink-3" htmlFor="ms-product">
              Product Type
            </label>
            <Select
              value={productType || 'all'}
              onValueChange={(v) => setProductType(v === 'all' ? '' : (v as ProductFilter))}
            >
              <SelectTrigger id="ms-product">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="FLIGHT">FLIGHT</SelectItem>
                <SelectItem value="HOTEL">HOTEL</SelectItem>
                <SelectItem value="BUS">BUS</SelectItem>
                <SelectItem value="VISA">VISA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-ink-3" htmlFor="ms-travel">
              Travel Type
            </label>
            <Select
              value={travelType || 'all'}
              onValueChange={(v) => setTravelType(v === 'all' ? '' : (v as TravelFilter))}
            >
              <SelectTrigger id="ms-travel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="DOMESTIC">DOMESTIC</SelectItem>
                <SelectItem value="INTERNATIONAL">INTERNATIONAL</SelectItem>
                <SelectItem value="BOTH">BOTH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-ink-3" htmlFor="ms-status">
              Status
            </label>
            <Select
              value={status || 'all'}
              onValueChange={(v) => setStatus(v === 'all' ? '' : (v as StatusFilter))}
            >
              <SelectTrigger id="ms-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-ink-3" htmlFor="ms-q">
              Search
            </label>
            <Input
              id="ms-q"
              placeholder="Source or supplier name"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setQ('');
              setStatus('');
              setTravelType('');
              setProductType('FLIGHT');
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface-1">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-ink-3">
          <span>
            Showing {list.data?.length ?? 0} {list.data?.length === 1 ? 'row' : 'rows'}
          </span>
        </div>
        <DataTable<PublicSupplierSource>
          columns={columns}
          data={list.data ?? []}
          loading={list.isPending}
          empty="No Map Sources yet — click Add new to create your first one."
        />
      </div>

      <MapSourceFormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        target={null}
      />
      <MapSourceFormDrawer
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        target={editTarget}
      />
    </div>
  );
}
