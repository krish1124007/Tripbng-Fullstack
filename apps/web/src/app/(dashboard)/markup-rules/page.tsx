'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Copy, Download, MoreHorizontal, Plus, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import type { PublicMarkupRule } from '@tripbng/shared';
import {
  Badge,
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
import { formatPaiseAsINR, formatPercentBasisPoints } from '@/lib/money';
import { MarkupRuleDrawer } from './_markup-rule-drawer';

// Curated carrier list for the Airline filter dropdown (IATA code → name).
const AIRLINES: { code: string; name: string }[] = [
  { code: '6E', name: 'IndiGo' },
  { code: 'AI', name: 'Air India' },
  { code: 'UK', name: 'Vistara' },
  { code: 'SG', name: 'SpiceJet' },
  { code: 'QP', name: 'Akasa Air' },
  { code: 'IX', name: 'Air India Express' },
  { code: 'G8', name: 'Go First' },
  { code: 'I5', name: 'AIX Connect' },
];
const AIRLINE_NAME: Record<string, string> = Object.fromEntries(
  AIRLINES.map((a) => [a.code, a.name]),
);

const ALL = '__ALL__';

const dtf = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
function formatDateTime(iso: string): string {
  try {
    return dtf.format(new Date(iso)).replace(',', ' |');
  } catch {
    return '—';
  }
}

interface Filters {
  q: string;
  airline: string;
  travelType: string;
  paxType: string;
  status: string;
}
const EMPTY_FILTERS: Filters = {
  q: '',
  airline: ALL,
  travelType: ALL,
  paxType: ALL,
  status: ALL,
};

export default function AgencyMarkupPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  // `draft` = what's in the search form; `applied` = what's committed to the query.
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicMarkupRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicMarkupRule | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      q: applied.q || undefined,
      airline: applied.airline === ALL ? undefined : applied.airline,
      travelType: applied.travelType === ALL ? undefined : applied.travelType,
      paxType: applied.paxType === ALL ? undefined : applied.paxType,
      status: applied.status === ALL ? undefined : applied.status,
    }),
    [page, applied],
  );

  const list = useApiPaginatedQuery<PublicMarkupRule>(
    ['markup-rules', queryParams],
    '/api/v1/markup-rules',
    { query: queryParams },
  );

  const invalidate = useInvalidateOnSuccess([['markup-rules']]);
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;

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
  const clone = useApiMutation<{ id: string }, PublicMarkupRule>(
    (i) => `/api/v1/markup-rules/${i.id}/clone`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Rule cloned (paused copy created)');
        invalidate();
      },
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
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => remove.mutateAsync({ id })));
    setSelected(new Set());
    setBulkDeleteOpen(false);
  }

  async function downloadExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (applied.q) params.set('q', applied.q);
      if (applied.airline !== ALL) params.set('airline', applied.airline);
      if (applied.travelType !== ALL) params.set('travelType', applied.travelType);
      if (applied.paxType !== ALL) params.set('paxType', applied.paxType);
      if (applied.status !== ALL) params.set('status', applied.status);
      const { data } = await apiFetchEnvelope<PublicMarkupRule[]>(
        `/api/v1/markup-rules?${params.toString()}`,
        { accessToken },
      );
      const header = [
        'Description',
        'Created Date',
        'Airline',
        'Travel Type',
        'Pax Type',
        'Value',
        'Scope',
        'Priority',
        'Last Updated Date',
        'Status',
      ];
      const csvRows = data.map((r) => {
        const c = r.conditions ?? {};
        const value =
          r.valueType === 'FLAT'
            ? formatPaiseAsINR(r.value, { compact: true })
            : formatPercentBasisPoints(r.value);
        return [
          r.name,
          formatDateTime(r.createdAt),
          c.airlines?.length ? c.airlines.join(' ') : 'All',
          c.travelType ?? 'All',
          c.paxTypes?.length ? c.paxTypes.join(' ') : 'All',
          value,
          r.scope,
          String(r.priority),
          formatDateTime(r.updatedAt),
          r.status,
        ];
      });
      const csv = [header, ...csvRows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agency-markup-${new Date().toISOString().slice(0, 10)}.csv`;
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

  const columns = useMemo<ColumnDef<PublicMarkupRule, unknown>[]>(
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
        header: 'Description',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-ink-1">{row.original.name}</span>
            {row.original.notes ? (
              <span className="text-xs text-ink-3">{row.original.notes}</span>
            ) : null}
          </div>
        ),
      },
      {
        header: 'Created Date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-2">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        header: 'Airline',
        cell: ({ row }) => {
          const al = row.original.conditions?.airlines ?? [];
          if (al.length === 0) return <span className="text-xs text-ink-3">All</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {al.map((c) => (
                <Badge key={c} variant="outline" className="font-mono text-[10px]">
                  {AIRLINE_NAME[c] ?? c}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        header: 'Travel Type',
        cell: ({ row }) => (
          <span className="text-xs text-ink-2">{row.original.conditions?.travelType ?? 'All'}</span>
        ),
      },
      {
        header: 'Pax Type',
        cell: ({ row }) => {
          const px = row.original.conditions?.paxTypes ?? [];
          return <span className="text-xs text-ink-2">{px.length ? px.join(', ') : 'All'}</span>;
        },
      },
      {
        header: 'Value',
        cell: ({ row }) => (
          <span className="font-mono text-sm tabular-nums">
            {row.original.valueType === 'FLAT'
              ? formatPaiseAsINR(row.original.value, { compact: true })
              : formatPercentBasisPoints(row.original.value)}
          </span>
        ),
      },
      {
        header: 'Last Updated Date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-2">
            {formatDateTime(row.original.updatedAt)}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
      },
      {
        header: 'Clone',
        id: 'clone',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clone rule"
            title="Duplicate this rule"
            onClick={(e) => {
              e.stopPropagation();
              clone.mutate({ id: row.original.id });
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
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
                <DropdownMenuItem onClick={() => clone.mutate({ id: row.original.id })}>
                  Clone
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
    [allChecked, selected, clone],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pricing"
        title="Agency Markup"
        description="Margin added to supplier base fares before they're shown to agents. Filter by airline, travel type, pax, or status."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadExcel} disabled={exporting || total === 0}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download as Excel'}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create Markup
            </Button>
          </div>
        }
      />

      {/* Search filters */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
          <FormField label="Description">
            <Input
              placeholder="Rule name / keyword"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
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
          <FormField label="Travel Type">
            <Select
              value={draft.travelType}
              onValueChange={(v) => setDraft((d) => ({ ...d, travelType: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="DOMESTIC">Domestic</SelectItem>
                <SelectItem value="INTERNATIONAL">International</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Pax Type">
            <Select value={draft.paxType} onValueChange={(v) => setDraft((d) => ({ ...d, paxType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="ADULT">Adult</SelectItem>
                <SelectItem value="CHILD">Child</SelectItem>
                <SelectItem value="INFANT">Infant</SelectItem>
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
                <SelectItem value="PAUSED">Paused</SelectItem>
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
        <div className="flex items-center justify-between rounded-lg border bg-surface-2 px-4 py-2">
          <span className="text-sm text-ink-2">{selected.size} selected</span>
          <Button variant="danger" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            Delete selected
          </Button>
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-3">
          Showing {rows.length} out of {total}
        </span>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={list.isLoading}
        empty="No Data Found"
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={total}
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
