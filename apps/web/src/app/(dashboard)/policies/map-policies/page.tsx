'use client';

// Map Policy list page — the "Manage Policy → Map Policy" screen from the
// admin panel spec (PDF screenshot 4). Filters at the top (product type /
// status / search) → data table → row actions for edit + status toggle +
// delete. The form drawer lives in `_map-policy-form-drawer.tsx`.

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicMapPolicy } from '@tripbng/shared';
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
import { MapPolicyFormDrawer } from './_map-policy-form-drawer';

type StatusFilter = '' | 'ACTIVE' | 'INACTIVE';
type ProductFilter = '' | 'FLIGHT' | 'HOTEL' | 'BUS' | 'VISA';

// "Policy Type" column — a comma-joined summary of which components are
// enabled on the policy. Mirrors the spec's column ("Commission, B2B Markup,
// Management Fee" etc).
function policyTypeSummary(p: PublicMapPolicy): string {
  const parts: string[] = [];
  if (p.commission?.enabled) parts.push('Commission');
  if (p.plb?.enabled) parts.push('PLB');
  if (p.b2bMarkup?.enabled) parts.push('B2B Markup');
  if (p.managementFee?.enabled) parts.push('Management Fee');
  return parts.length ? parts.join(', ') : '—';
}

export default function MapPoliciesPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [productType, setProductType] = useState<ProductFilter>('FLIGHT');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicMapPolicy | null>(null);

  const query = useMemo(() => {
    const out: Record<string, string> = {};
    if (q) out.q = q;
    if (status) out.status = status;
    if (productType) out.productType = productType;
    return out;
  }, [q, status, productType]);

  const list = useApiQuery<PublicMapPolicy[]>(
    ['map-policies', query],
    '/api/v1/map-policies',
    { query },
  );

  const invalidate = useInvalidateOnSuccess([['map-policies']]);
  const update = useApiMutation<
    { id: string; status: 'ACTIVE' | 'INACTIVE' },
    { id: string }
  >((i) => `/api/v1/map-policies/${i.id}`, 'PATCH', {
    onSuccess: () => {
      toast.success('Map Policy updated');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const remove = useApiMutation<{ id: string }, { ok: boolean }>(
    (i) => `/api/v1/map-policies/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Map Policy deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const columns = useMemo<ColumnDef<PublicMapPolicy, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Policy Name',
        cell: ({ row }) => (
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => setEditTarget(row.original)}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        accessorKey: 'morePayoutAny',
        header: 'More Payout',
        cell: ({ row }) => (
          <span className={row.original.morePayoutAny ? 'text-success' : 'text-ink-3'}>
            {row.original.morePayoutAny ? 'Y' : 'N'}
          </span>
        ),
      },
      {
        id: 'policyType',
        header: 'Policy Type',
        cell: ({ row }) => (
          <span className="text-ink-2">{policyTypeSummary(row.original)}</span>
        ),
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) => (
          <span className="text-ink-3 text-xs">
            {new Date(row.original.createdAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: ({ row }) => (
          <span className="text-ink-3 text-xs">
            {new Date(row.original.updatedAt).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </span>
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
            <StatusBadge status={row.original.status} />
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
                    `Delete Map Policy "${row.original.name}"? This cannot be undone.`,
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
        title="Map Policy"
        description="Manage Policy  ›  Map Policy — commission, PLB, B2B markup, and management fee rules per supplier/airline/agency-group combo."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create
          </Button>
        }
      />

      <div className="rounded-md border border-border bg-surface-1 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-ink-3" htmlFor="mp-product">
              Product Type
            </label>
            <Select
              value={productType || 'all'}
              onValueChange={(v) =>
                setProductType(v === 'all' ? '' : (v as ProductFilter))
              }
            >
              <SelectTrigger id="mp-product">
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
            <label className="text-xs text-ink-3" htmlFor="mp-status">
              Status
            </label>
            <Select
              value={status || 'all'}
              onValueChange={(v) => setStatus(v === 'all' ? '' : (v as StatusFilter))}
            >
              <SelectTrigger id="mp-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-ink-3" htmlFor="mp-q">
              Search
            </label>
            <Input
              id="mp-q"
              placeholder="Policy name"
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
        <DataTable<PublicMapPolicy>
          columns={columns}
          data={list.data ?? []}
          loading={list.isPending}
          empty="No Map Policies yet — click Create to add your first one."
        />
      </div>

      <MapPolicyFormDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        target={null}
      />
      <MapPolicyFormDrawer
        open={editTarget !== null}
        onOpenChange={(o) => {
          if (!o) setEditTarget(null);
        }}
        target={editTarget}
      />
    </div>
  );
}
