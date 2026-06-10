'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { POLICY_PRODUCT_TYPE, type PublicPolicy } from '@tripbng/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormField,
  Input,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { apiFetchEnvelope } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const PRODUCT_LABEL: Record<string, string> = {
  AIR: 'Air',
  HOTEL: 'Hotel',
  BUS: 'Bus',
  HOLIDAY: 'Holiday',
  INSURANCE: 'Insurance',
};

const ALL = '__ALL__';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date} | ${time}`;
}

export default function PoliciesPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Draft search inputs vs. applied filters (applied on Search click).
  const [draft, setDraft] = useState({ productType: ALL, name: '', status: ALL });
  const [applied, setApplied] = useState({ productType: ALL, name: '', status: ALL });

  const list = useApiPaginatedQuery<PublicPolicy>(
    ['policies', { page, ...applied }],
    '/api/v1/policies',
    {
      query: {
        page,
        limit: 20,
        q: applied.name || undefined,
        productType: applied.productType === ALL ? undefined : applied.productType,
        status: applied.status === ALL ? undefined : applied.status,
      },
    },
  );

  const invalidate = useInvalidateOnSuccess([['policies']]);
  const toggleStatus = useApiMutation<{ id: string; status: 'ACTIVE' | 'INACTIVE' }, PublicPolicy>(
    (i) => `/api/v1/policies/${i.id}`,
    'PATCH',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/policies/${i.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Policy deleted');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const [deleteTarget, setDeleteTarget] = useState<PublicPolicy | null>(null);

  async function downloadExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (applied.name) params.set('q', applied.name);
      if (applied.productType !== ALL) params.set('productType', applied.productType);
      if (applied.status !== ALL) params.set('status', applied.status);
      const { data } = await apiFetchEnvelope<PublicPolicy[]>(
        `/api/v1/policies?${params.toString()}`,
        { accessToken },
      );
      const header = [
        'Policy Name',
        'Product',
        'Policy Type',
        'More Payout',
        'Created Date',
        'Created By',
        'Last Updated Date',
        'Updated By',
        'Status',
      ];
      const csvRows = data.map((p) => [
        p.name,
        PRODUCT_LABEL[p.productType] ?? p.productType,
        p.policyType || '—',
        p.morePayout ? 'Y' : 'N',
        formatDateTime(p.createdAt),
        p.createdBy ?? '—',
        formatDateTime(p.updatedAt),
        p.updatedBy ?? '—',
        p.status,
      ]);
      const csv = [header, ...csvRows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `policies-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} polic${data.length === 1 ? 'y' : 'ies'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const total = list.data?.meta.total ?? 0;
  const shown = list.data?.data.length ?? 0;

  const columns = useMemo<ColumnDef<PublicPolicy, unknown>[]>(
    () => [
      {
        header: 'Policy Name',
        accessorKey: 'name',
        cell: ({ row }) => (
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/policies/${row.original.id}`);
            }}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        header: 'More Payout',
        cell: ({ row }) => (
          <span className={row.original.morePayout ? 'font-semibold text-success' : 'text-ink-3'}>
            {row.original.morePayout ? 'Y' : 'N'}
          </span>
        ),
      },
      {
        header: 'Policy Type',
        cell: ({ row }) =>
          row.original.policyType ? (
            <span className="text-sm text-ink-2">{row.original.policyType}</span>
          ) : (
            <span className="text-ink-4">—</span>
          ),
      },
      { header: 'Product', cell: ({ row }) => <Badge variant="outline">{PRODUCT_LABEL[row.original.productType]}</Badge> },
      {
        header: 'Created Date',
        cell: ({ row }) => <span className="text-xs text-ink-3">{formatDateTime(row.original.createdAt)}</span>,
      },
      {
        header: 'Created By',
        cell: ({ row }) => <span className="text-sm text-ink-2">{row.original.createdBy ?? '—'}</span>,
      },
      {
        header: 'Last Updated',
        cell: ({ row }) => <span className="text-xs text-ink-3">{formatDateTime(row.original.updatedAt)}</span>,
      },
      {
        header: 'Updated By',
        cell: ({ row }) => <span className="text-sm text-ink-2">{row.original.updatedBy ?? '—'}</span>,
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.original.status === 'ACTIVE'}
              onCheckedChange={(c) =>
                toggleStatus.mutate({ id: row.original.id, status: c ? 'ACTIVE' : 'INACTIVE' })
              }
            />
          </div>
        ),
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Row actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/policies/${row.original.id}`)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => setDeleteTarget(row.original)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [router, toggleStatus],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Manage Policy"
        title="Map Policy"
        description="Commission, PLB, B2B markup, and management-fee payout policies."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadExcel} disabled={exporting || total === 0}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download as Excel'}
            </Button>
            <Button onClick={() => router.push('/policies/new')}>
              <Plus className="h-4 w-4" /> Create
            </Button>
          </div>
        }
      />

      {/* Search */}
      <div className="grid items-end gap-4 rounded-lg border bg-surface-1 p-4 md:grid-cols-4">
        <FormField label="Product Type">
          <Select value={draft.productType} onValueChange={(v) => setDraft((d) => ({ ...d, productType: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {POLICY_PRODUCT_TYPE.map((t) => (
                <SelectItem key={t} value={t}>
                  {PRODUCT_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Policy Name">
          <Input
            placeholder="Search name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </FormField>
        <FormField label="Status">
          <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}>
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setPage(1);
              setApplied(draft);
            }}
          >
            Search
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const reset = { productType: ALL, name: '', status: ALL };
              setDraft(reset);
              setApplied(reset);
              setPage(1);
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      <span className="block text-xs text-ink-3">
        Showing {shown} out of {total}
      </span>

      <DataTable
        columns={columns}
        data={list.data?.data ?? []}
        loading={list.isLoading}
        empty="No Data Found"
        onRowClick={(row) => router.push(`/policies/${row.id}`)}
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={total}
        onPageChange={setPage}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Inventories using this policy will fall back to defaults."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync({ id: deleteTarget.id });
        }}
      />
    </div>
  );
}
