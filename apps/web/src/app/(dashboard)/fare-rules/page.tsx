'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { Download, MoreHorizontal, Plus, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  AIRLINES,
  airlineName,
  FARE_RULE_CABIN_TYPE,
  FARE_RULE_REFUND_TYPE,
  FARE_RULE_TRIP_TYPE,
  type PublicFareRule,
} from '@tripbng/shared';
import {
  Button,
  Card,
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
  StatusBadge,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { apiFetchEnvelope } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

const ALL = '__ALL__';

const TITLE: Record<string, string> = {
  ALL: 'All',
  ONEWAY: 'One-way',
  ROUNDTRIP: 'Round-trip',
  MULTICITY: 'Multi-city',
  ECONOMY: 'Economy',
  PREMIUM_ECONOMY: 'Premium Economy',
  BUSINESS: 'Business',
  FIRST: 'First',
  REFUNDABLE: 'Refundable',
  NON_REFUNDABLE: 'Non-refundable',
  PARTIAL: 'Partial',
};
const label = (v: string) => TITLE[v] ?? v;

const dtf = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const formatDateTime = (iso: string) => {
  try {
    return dtf.format(new Date(iso)).replace(',', ' |');
  } catch {
    return '—';
  }
};

interface NamedRow {
  id: string;
  name: string;
  code?: string;
}

interface Filters {
  q: string;
  source: string;
  agencyGroup: string;
  tripType: string;
  cabinType: string;
  refundType: string;
  airline: string;
  status: string;
}
const EMPTY_FILTERS: Filters = {
  q: '',
  source: ALL,
  agencyGroup: ALL,
  tripType: ALL,
  cabinType: ALL,
  refundType: ALL,
  airline: ALL,
  status: ALL,
};

export default function ManageFareRulePage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const perms = useAuthStore((s) => s.user?.permissions ?? []);

  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [deleteTarget, setDeleteTarget] = useState<PublicFareRule | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const suppliers = useApiPaginatedQuery<NamedRow>(['suppliers-lite'], '/api/v1/suppliers', {
    query: { limit: 200 },
    enabled: perms.includes('supplier:read'),
  });
  const agencyGroups = useApiPaginatedQuery<NamedRow>(['agency-groups-lite'], '/api/v1/agency-groups', {
    query: { limit: 200 },
    enabled: perms.includes('agency-group:read'),
  });
  const supplierRows = suppliers.data?.data ?? [];
  const agencyGroupRows = agencyGroups.data?.data ?? [];

  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      q: applied.q || undefined,
      source: applied.source === ALL ? undefined : applied.source,
      agencyGroup: applied.agencyGroup === ALL ? undefined : applied.agencyGroup,
      tripType: applied.tripType === ALL ? undefined : applied.tripType,
      cabinType: applied.cabinType === ALL ? undefined : applied.cabinType,
      refundType: applied.refundType === ALL ? undefined : applied.refundType,
      airline: applied.airline === ALL ? undefined : applied.airline,
      status: applied.status === ALL ? undefined : applied.status,
    }),
    [page, applied],
  );

  const list = useApiPaginatedQuery<PublicFareRule>(
    ['fare-rules', queryParams],
    '/api/v1/fare-rules',
    { query: queryParams },
  );
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;

  const invalidate = useInvalidateOnSuccess([['fare-rules']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/fare-rules/${i.id}`,
    'DELETE',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );
  const patchStatus = useApiMutation<{ id: string; status: string }, PublicFareRule>(
    (i) => `/api/v1/fare-rules/${i.id}`,
    'PATCH',
    {
      onSuccess: () => invalidate(),
      onError: (err) => toast.error(err.message),
    },
  );

  function runSearch() {
    setPage(1);
    setSelected(new Set());
    setApplied(draft);
  }
  function resetSearch() {
    setPage(1);
    setSelected(new Set());
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function bulkSetStatus(status: 'ACTIVE' | 'INACTIVE') {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => patchStatus.mutateAsync({ id, status })));
    toast.success(`${ids.length} rule${ids.length === 1 ? '' : 's'} ${status === 'ACTIVE' ? 'activated' : 'deactivated'}`);
    setSelected(new Set());
  }
  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => remove.mutateAsync({ id })));
    toast.success(`${ids.length} rule${ids.length === 1 ? '' : 's'} deleted`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
  }

  async function downloadExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (applied.q) params.set('q', applied.q);
      if (applied.source !== ALL) params.set('source', applied.source);
      if (applied.agencyGroup !== ALL) params.set('agencyGroup', applied.agencyGroup);
      if (applied.tripType !== ALL) params.set('tripType', applied.tripType);
      if (applied.cabinType !== ALL) params.set('cabinType', applied.cabinType);
      if (applied.refundType !== ALL) params.set('refundType', applied.refundType);
      if (applied.airline !== ALL) params.set('airline', applied.airline);
      if (applied.status !== ALL) params.set('status', applied.status);
      const { data } = await apiFetchEnvelope<PublicFareRule[]>(
        `/api/v1/fare-rules?${params.toString()}`,
        { accessToken },
      );
      const header = [
        'Fare Rule Name',
        'Cabin',
        'Refund Type',
        'Trip Type',
        'Airline',
        'Source',
        'Agency Group',
        'Created Date',
        'Last Updated Date',
        'Status',
      ];
      const csvRows = data.map((r) => [
        r.name,
        label(r.cabinType),
        label(r.refundType),
        label(r.tripType),
        r.airline ? airlineName(r.airline) : 'All',
        r.sourceName ?? 'All',
        r.agencyGroupName ?? 'All',
        formatDateTime(r.createdAt),
        formatDateTime(r.updatedAt),
        r.status,
      ]);
      const csv = [header, ...csvRows]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fare-rules-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} rule${data.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const allChecked = rows.length > 0 && selected.size === rows.length;

  const columns = useMemo<ColumnDef<PublicFareRule, unknown>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all"
            className="h-4 w-4 cursor-pointer rounded border-ink-4 accent-accent"
            checked={allChecked}
            onChange={toggleAll}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.name}`}
            className="h-4 w-4 cursor-pointer rounded border-ink-4 accent-accent"
            checked={selected.has(row.original.id)}
            onChange={() => toggleRow(row.original.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        header: 'Fare Rule Name',
        accessorKey: 'name',
        cell: ({ row }) => <span className="font-medium text-ink-1">{row.original.name}</span>,
      },
      { header: 'Cabin', cell: ({ row }) => <span className="text-xs text-ink-2">{label(row.original.cabinType)}</span> },
      { header: 'Refund Type', cell: ({ row }) => <span className="text-xs text-ink-2">{label(row.original.refundType)}</span> },
      { header: 'Trip Type', cell: ({ row }) => <span className="text-xs text-ink-2">{label(row.original.tripType)}</span> },
      {
        header: 'Airline',
        cell: ({ row }) => (
          <span className="text-xs text-ink-2">{row.original.airline ? airlineName(row.original.airline) : 'All'}</span>
        ),
      },
      { header: 'Source', cell: ({ row }) => <span className="text-xs text-ink-2">{row.original.sourceName ?? 'All'}</span> },
      {
        header: 'Agency Group',
        cell: ({ row }) => <span className="text-xs text-ink-2">{row.original.agencyGroupName ?? 'All'}</span>,
      },
      {
        header: 'Created Date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-3">{formatDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        header: 'Last Updated Date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-3">{formatDateTime(row.original.updatedAt)}</span>
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
                <Button variant="ghost" size="icon" aria-label="Row actions" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/fare-rules/${row.original.id}`)}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    patchStatus.mutate({
                      id: row.original.id,
                      status: row.original.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    })
                  }
                >
                  {row.original.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
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
    [allChecked, selected, router, patchStatus],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pricing"
        title="Manage Fare Rule"
        description="Cancellation, reschedule, and no-show terms — scoped by airline, source, agency group, trip, cabin, and refund type."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadExcel} disabled={exporting || total === 0}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download as Excel'}
            </Button>
            <Button onClick={() => router.push('/fare-rules/new')}>
              <Plus className="h-4 w-4" /> Create Fare Rule
            </Button>
          </div>
        }
      />

      {/* Search filters */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <FormField label="Fare Rule Name">
            <Input
              placeholder="Rule name / keyword"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Source Name">
            <Select value={draft.source} onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sources</SelectItem>
                {supplierRows.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Agency Group">
            <Select value={draft.agencyGroup} onValueChange={(v) => setDraft((d) => ({ ...d, agencyGroup: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All groups</SelectItem>
                {agencyGroupRows.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Trip Type">
            <Select value={draft.tripType} onValueChange={(v) => setDraft((d) => ({ ...d, tripType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {FARE_RULE_TRIP_TYPE.filter((t) => t !== 'ALL').map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Cabin Type">
            <Select value={draft.cabinType} onValueChange={(v) => setDraft((d) => ({ ...d, cabinType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {FARE_RULE_CABIN_TYPE.filter((t) => t !== 'ALL').map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Refundable Type">
            <Select value={draft.refundType} onValueChange={(v) => setDraft((d) => ({ ...d, refundType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {FARE_RULE_REFUND_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Airline Name">
            <Select value={draft.airline} onValueChange={(v) => setDraft((d) => ({ ...d, airline: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All airlines</SelectItem>
                {AIRLINES.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Status">
            <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={resetSearch}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Button>
          <Button onClick={runSearch}>
            <Search className="h-4 w-4" /> Search
          </Button>
        </div>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-surface-2 px-4 py-2">
          <span className="text-sm text-ink-2">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => bulkSetStatus('ACTIVE')}>
              Activate
            </Button>
            <Button variant="secondary" size="sm" onClick={() => bulkSetStatus('INACTIVE')}>
              Deactivate
            </Button>
            <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <span className="block text-xs text-ink-3">
        Showing {rows.length} out of {total}
      </span>

      <DataTable columns={columns} data={rows} loading={list.isLoading} empty="No Data Found" />

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
        description="This won't affect bookings already issued under this rule, but new bookings won't see it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) {
            await remove.mutateAsync({ id: deleteTarget.id });
            toast.success('Fare rule deleted');
          }
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selected.size} selected rule${selected.size === 1 ? '' : 's'}?`}
        description="This is immediate and cannot be undone."
        confirmLabel="Delete selected"
        destructive
        onConfirm={bulkDelete}
      />
    </div>
  );
}
