'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Calendar, Copy, Download, MoreHorizontal, Pause, Play, Plus, RotateCcw, Search } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  AIRLINES,
  airlineName,
  INVENTORY_STATUS,
  TRAVEL_TYPE,
  type PublicInventory,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
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
import { CreateInventoryWizard } from './_create-inventory-wizard';
import { EditInventoryDrawer } from './_edit-inventory-drawer';

const ALL = '__ALL__';

interface NamedRow {
  id: string;
  name: string;
  code?: string;
}

const dtf = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const df = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) => {
  try {
    return dtf.format(new Date(iso)).replace(',', ' |');
  } catch {
    return '—';
  }
};
const fmtDate = (iso: string) => {
  try {
    return df.format(new Date(iso));
  } catch {
    return '—';
  }
};

interface Filters {
  inventoryName: string;
  inventoryCode: string;
  origin: string;
  destination: string;
  airline: string;
  pnr: string;
  supplierId: string;
  travelType: string;
  status: string;
  startDate: string;
  endDate: string;
}
const EMPTY: Filters = {
  inventoryName: '',
  inventoryCode: '',
  origin: '',
  destination: '',
  airline: ALL,
  pnr: '',
  supplierId: ALL,
  travelType: ALL,
  status: ALL,
  startDate: '',
  endDate: '',
};

export default function InventoriesPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicInventory | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const suppliers = useApiPaginatedQuery<NamedRow>(['suppliers-lite'], '/api/v1/suppliers', {
    query: { limit: 200 },
    enabled: perms.includes('supplier:read'),
  });
  const supplierRows = suppliers.data?.data ?? [];

  const queryParams = useMemo(() => {
    const p: Record<string, unknown> = { page, limit: 20 };
    if (applied.inventoryName) p.inventoryName = applied.inventoryName;
    if (applied.inventoryCode) p.inventoryCode = applied.inventoryCode;
    if (applied.origin) p.origin = applied.origin;
    if (applied.destination) p.destination = applied.destination;
    if (applied.airline !== ALL) p.airline = applied.airline;
    if (applied.pnr) p.pnr = applied.pnr;
    if (applied.supplierId !== ALL) p.supplierId = applied.supplierId;
    if (applied.travelType !== ALL) p.travelType = applied.travelType;
    if (applied.status !== ALL) p.status = applied.status;
    if (applied.startDate) p.startDate = applied.startDate;
    if (applied.endDate) p.endDate = applied.endDate;
    return p;
  }, [page, applied]);

  const list = useApiPaginatedQuery<PublicInventory>(
    ['inventories', queryParams],
    '/api/v1/inventories',
    { query: queryParams },
  );
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;

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

  function runSearch() {
    setPage(1);
    setSelected(new Set());
    setApplied(draft);
  }
  function resetSearch() {
    setPage(1);
    setSelected(new Set());
    setDraft(EMPTY);
    setApplied(EMPTY);
  }
  function toggleRow(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((p) => (p.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  async function downloadExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      Object.entries(queryParams).forEach(([k, v]) => {
        if (k !== 'page' && k !== 'limit' && v != null) params.set(k, String(v));
      });
      const { data } = await apiFetchEnvelope<PublicInventory[]>(
        `/api/v1/inventories?${params.toString()}`,
        { accessToken },
      );
      const header = [
        'Inventory ID',
        'Created Date',
        'Inventory Name',
        'Series Start',
        'Series End',
        'Available',
        'Sold',
        'Origin',
        'Destination',
        'Airline',
        'Travel Type',
        'Status',
      ];
      const csvRows = data.map((i) => {
        const air = i.segments?.[0]?.airline;
        return [
          i.inventoryCode,
          fmtDateTime(i.createdAt),
          i.inventoryName,
          fmtDate(i.seriesStartDate),
          fmtDate(i.seriesEndDate),
          String(i.seatsRemaining),
          String(i.totalSeats - i.seatsRemaining),
          `${i.origin.name ?? ''} (${i.origin.code})`.trim(),
          `${i.destination.name ?? ''} (${i.destination.code})`.trim(),
          air ? `${air.name ?? airlineName(air.code)} (${air.code})` : '—',
          i.travelType,
          i.status,
        ];
      });
      const csv = [header, ...csvRows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} inventor${data.length === 1 ? 'y' : 'ies'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const allChecked = rows.length > 0 && selected.size === rows.length;

  const columns = useMemo<ColumnDef<PublicInventory, unknown>[]>(
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
            aria-label={`Select ${row.original.inventoryName}`}
            className="h-4 w-4 cursor-pointer rounded border-ink-4 accent-accent"
            checked={selected.has(row.original.id)}
            onChange={() => toggleRow(row.original.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      {
        header: 'Inventory id',
        cell: ({ row }) => (
          <button
            type="button"
            className="font-mono text-xs font-semibold text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setEditTarget(row.original);
            }}
          >
            {row.original.inventoryCode}
          </button>
        ),
      },
      {
        header: 'Created date',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-3">{fmtDateTime(row.original.createdAt)}</span>
        ),
      },
      {
        header: 'Inventory name',
        accessorKey: 'inventoryName',
        cell: ({ getValue }) => <span className="text-sm text-ink-1">{getValue() as string}</span>,
      },
      {
        header: 'Series',
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-ink-2 tabular-nums">
            {fmtDate(row.original.seriesStartDate)} → {fmtDate(row.original.seriesEndDate)}
          </span>
        ),
      },
      {
        header: 'Seats remaining',
        cell: ({ row }) => {
          const sold = row.original.totalSeats - row.original.seatsRemaining;
          const pct = row.original.totalSeats
            ? (row.original.seatsRemaining / row.original.totalSeats) * 100
            : 0;
          const tone = pct < 10 ? 'danger' : pct < 30 ? 'warning' : 'success';
          return (
            <div className="flex items-center gap-2">
              <Badge variant={tone}>{row.original.seatsRemaining} Available</Badge>
              <span className="text-xs text-ink-3">{sold} Sold</span>
            </div>
          );
        },
      },
      {
        header: 'Origin → Destination',
        cell: ({ row }) => (
          <span className="text-xs text-ink-2">
            {row.original.origin.name ?? row.original.origin.code} ({row.original.origin.code}) →{' '}
            {row.original.destination.name ?? row.original.destination.code} ({row.original.destination.code})
          </span>
        ),
      },
      {
        header: 'Airline',
        cell: ({ row }) => {
          const air = row.original.segments?.[0]?.airline;
          if (!air) return <span className="text-xs text-ink-3">—</span>;
          return (
            <span className="text-xs text-ink-2">
              {air.name ?? airlineName(air.code)} ({air.code})
            </span>
          );
        },
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <StatusBadge status={row.original.status} />
          </div>
        ),
      },
      {
        header: 'Clone',
        id: 'clone',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clone inventory"
            title="Clone to draft"
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
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Row actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setEditTarget(row.original)}>Edit</DropdownMenuItem>
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
    [allChecked, selected, togglePause, clone],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Series"
        title="Manage Inventory"
        description="Bulk-held series fares — track seats remaining against pre-purchased stock."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" asChild>
              <Link href="/inventories/calendar">
                <Calendar className="h-4 w-4" /> Calendar
              </Link>
            </Button>
            <Button variant="secondary" onClick={downloadExcel} disabled={exporting || total === 0}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download as Excel'}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create Inventory
            </Button>
          </div>
        }
      />

      {/* Search filters */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          <FormField label="Inventory Name">
            <Input
              placeholder="e.g. Diwali Special"
              value={draft.inventoryName}
              onChange={(e) => setDraft((d) => ({ ...d, inventoryName: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Inventory Id">
            <Input
              placeholder="INVT00002"
              value={draft.inventoryCode}
              onChange={(e) => setDraft((d) => ({ ...d, inventoryCode: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Origin">
            <Input
              placeholder="DEL"
              value={draft.origin}
              onChange={(e) => setDraft((d) => ({ ...d, origin: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Destination">
            <Input
              placeholder="BOM"
              value={draft.destination}
              onChange={(e) => setDraft((d) => ({ ...d, destination: e.target.value }))}
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
          <FormField label="PNR">
            <Input
              placeholder="Airline PNR"
              value={draft.pnr}
              onChange={(e) => setDraft((d) => ({ ...d, pnr: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Supplier">
            <Select value={draft.supplierId} onValueChange={(v) => setDraft((d) => ({ ...d, supplierId: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All suppliers</SelectItem>
                {supplierRows.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Travel Type">
            <Select value={draft.travelType} onValueChange={(v) => setDraft((d) => ({ ...d, travelType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {TRAVEL_TYPE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
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
                {INVENTORY_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Start Date">
            <Input
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
            />
          </FormField>
          <FormField label="End Date">
            <Input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
            />
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

      {selected.size > 0 ? (
        <div className="flex items-center justify-between rounded-lg border bg-surface-2 px-4 py-2">
          <span className="text-sm text-ink-2">{selected.size} selected</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const ids = Array.from(selected);
              await Promise.allSettled(ids.map((id) => clone.mutateAsync({ id })));
              setSelected(new Set());
            }}
          >
            <Copy className="h-4 w-4" /> Clone selected
          </Button>
        </div>
      ) : null}

      <span className="block text-xs text-ink-3">
        Showing {rows.length} out of {total}
      </span>

      <DataTable
        columns={columns}
        data={rows}
        loading={list.isLoading}
        onRowClick={(inv) => setEditTarget(inv)}
        empty="No Data Found"
      />

      <Pagination
        page={page}
        totalPages={list.data?.meta.totalPages ?? 1}
        total={total}
        onPageChange={setPage}
      />

      <CreateInventoryWizard open={createOpen} onOpenChange={setCreateOpen} />
      <EditInventoryDrawer target={editTarget} onOpenChange={(open) => !open && setEditTarget(null)} />
    </div>
  );
}
