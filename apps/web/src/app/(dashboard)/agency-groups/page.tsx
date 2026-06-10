'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Download, MoreHorizontal, Plus, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  AIRLINES,
  CreateAgencyGroupRequestSchema,
  type CreateAgencyGroupRequest,
  type PublicAgency,
  type PublicAgencyGroup,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DrawerContent,
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
  Switch,
  Textarea,
} from '@/components/ui';
import { useApiMutation, useApiPaginatedQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { apiFetchEnvelope } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';

const ALL = '__ALL__';

interface Filters {
  q: string;
  agencyId: string;
  agencyName: string;
  status: string;
}
const EMPTY_FILTERS: Filters = { q: '', agencyId: '', agencyName: '', status: ALL };

export default function AgencyGroupsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicAgencyGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PublicAgencyGroup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(
    () => ({
      page,
      limit: 20,
      q: applied.q || undefined,
      agencyId: applied.agencyId || undefined,
      agencyName: applied.agencyName || undefined,
      status: applied.status === ALL ? undefined : applied.status,
    }),
    [page, applied],
  );

  const list = useApiPaginatedQuery<PublicAgencyGroup>(
    ['agency-groups', queryParams],
    '/api/v1/agency-groups',
    { query: queryParams },
  );
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;

  const invalidate = useInvalidateOnSuccess([['agency-groups']]);
  const remove = useApiMutation<{ id: string }, { ok: true }>(
    (i) => `/api/v1/agency-groups/${i.id}`,
    'DELETE',
    { onSuccess: () => invalidate(), onError: (err) => toast.error(err.message) },
  );
  const patchStatus = useApiMutation<{ id: string; status: string }, PublicAgencyGroup>(
    (i) => `/api/v1/agency-groups/${i.id}`,
    'PATCH',
    { onSuccess: () => invalidate(), onError: (err) => toast.error(err.message) },
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
  async function bulkSetStatus(status: 'ACTIVE' | 'INACTIVE') {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => patchStatus.mutateAsync({ id, status })));
    toast.success(`${ids.length} group${ids.length === 1 ? '' : 's'} updated`);
    setSelected(new Set());
  }
  async function bulkDelete() {
    const ids = Array.from(selected);
    await Promise.allSettled(ids.map((id) => remove.mutateAsync({ id })));
    toast.success(`${ids.length} group${ids.length === 1 ? '' : 's'} deleted`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
  }

  async function downloadExcel() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (applied.q) params.set('q', applied.q);
      if (applied.agencyId) params.set('agencyId', applied.agencyId);
      if (applied.agencyName) params.set('agencyName', applied.agencyName);
      if (applied.status !== ALL) params.set('status', applied.status);
      const { data } = await apiFetchEnvelope<PublicAgencyGroup[]>(
        `/api/v1/agency-groups?${params.toString()}`,
        { accessToken },
      );
      const header = ['Group Name', 'Mapped Agency Count', 'Mapped Airline Count', 'Status'];
      const csvRows = data.map((g) => [g.name, String(g.agencyCount), String(g.airlineCount), g.status]);
      const csv = [header, ...csvRows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `agency-groups-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.length} group${data.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const allChecked = rows.length > 0 && selected.size === rows.length;

  const columns = useMemo<ColumnDef<PublicAgencyGroup, unknown>[]>(
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
        header: 'Group name',
        accessorKey: 'name',
        cell: ({ row }) => (
          <button
            type="button"
            className="font-semibold text-accent hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              setEditTarget(row.original);
            }}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        header: 'Mapped agency count',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.agencyCount}
          </Badge>
        ),
      },
      {
        header: 'Mapped airline count',
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.airlineCount}
          </Badge>
        ),
      },
      {
        header: 'Status',
        cell: ({ row }) => (
          <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
            <Switch
              checked={row.original.status === 'ACTIVE'}
              onCheckedChange={(c) =>
                patchStatus.mutate({ id: row.original.id, status: c ? 'ACTIVE' : 'INACTIVE' })
              }
            />
            <StatusBadge status={row.original.status} />
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
                <DropdownMenuItem onClick={() => setEditTarget(row.original)}>Edit</DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => setDeleteTarget(row.original)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    [allChecked, selected, patchStatus],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Channel"
        title="Agency Group"
        description="Cluster sub-agencies to apply policies, markups, and fare rules at scale."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadExcel} disabled={exporting || total === 0}>
              <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Download as Excel'}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create Group
            </Button>
          </div>
        }
      />

      {/* Search */}
      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <FormField label="Group Name">
            <Input
              placeholder="Group name / keyword"
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Agency id">
            <Input
              placeholder="Agency code / id"
              value={draft.agencyId}
              onChange={(e) => setDraft((d) => ({ ...d, agencyId: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
          </FormField>
          <FormField label="Agency name">
            <Input
              placeholder="Sub-agency name"
              value={draft.agencyName}
              onChange={(e) => setDraft((d) => ({ ...d, agencyName: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            />
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

      <AgencyGroupDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <AgencyGroupDrawer
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Markup rules, policies, and fare rules targeting this group will silently skip it."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) {
            await remove.mutateAsync({ id: deleteTarget.id });
            toast.success('Group deleted');
          }
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selected.size} selected group${selected.size === 1 ? '' : 's'}?`}
        description="This is immediate and cannot be undone."
        confirmLabel="Delete selected"
        destructive
        onConfirm={bulkDelete}
      />
    </div>
  );
}

function AgencyGroupDrawer({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: PublicAgencyGroup | null;
}) {
  const editing = !!target;
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateAgencyGroupRequest>({
    resolver: zodResolver(CreateAgencyGroupRequestSchema),
    defaultValues: { agencyIds: [], airlineCodes: [], status: 'ACTIVE' },
  });
  const agencyIds = watch('agencyIds') ?? [];
  const airlineCodes = watch('airlineCodes') ?? [];
  const status = watch('status');

  const agencies = useApiPaginatedQuery<PublicAgency>(
    ['agencies-for-group-picker'],
    '/api/v1/agencies',
    { query: { limit: 200 }, enabled: open },
  );

  useEffect(() => {
    if (target) {
      reset({
        name: target.name,
        description: target.description ?? undefined,
        agencyIds: target.agencyIds,
        airlineCodes: target.airlineCodes,
        status: target.status,
      });
    } else if (!open) {
      reset({ agencyIds: [], airlineCodes: [], status: 'ACTIVE' });
    }
  }, [target, open, reset]);

  const invalidate = useInvalidateOnSuccess([['agency-groups']]);
  const create = useApiMutation<CreateAgencyGroupRequest, PublicAgencyGroup>(
    '/api/v1/agency-groups',
    'POST',
    {
      onSuccess: () => {
        toast.success('Group created');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const update = useApiMutation<CreateAgencyGroupRequest, PublicAgencyGroup>(
    () => `/api/v1/agency-groups/${target?.id}`,
    'PATCH',
    {
      onSuccess: () => {
        toast.success('Group updated');
        invalidate();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const toggleAgency = (id: string) => {
    const next = agencyIds.includes(id) ? agencyIds.filter((x) => x !== id) : [...agencyIds, id];
    setValue('agencyIds', next, { shouldValidate: true });
  };
  const toggleAirline = (code: string) => {
    const next = airlineCodes.includes(code)
      ? airlineCodes.filter((x) => x !== code)
      : [...airlineCodes, code];
    setValue('airlineCodes', next, { shouldValidate: true });
  };

  const submit = handleSubmit((v) => (editing ? update.mutate(v) : create.mutate(v)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent width="w-[640px]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${target?.name}` : 'New agency group'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col">
          <DialogBody className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <FormField id="name" label="Group name" required error={errors.name?.message}>
                <Input id="name" {...register('name')} />
              </FormField>
              <FormField label="Status">
                <div className="flex h-10 items-center gap-3 rounded-md border bg-surface-1 px-3">
                  <Switch
                    checked={status === 'ACTIVE'}
                    onCheckedChange={(c) => setValue('status', c ? 'ACTIVE' : 'INACTIVE')}
                  />
                  <span
                    className={cn(
                      'text-sm font-medium',
                      status === 'ACTIVE' ? 'text-success' : 'text-ink-3',
                    )}
                  >
                    {status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </FormField>
            </div>

            <FormField id="description" label="Description">
              <Textarea id="description" rows={2} {...register('description')} />
            </FormField>

            <FormField label={`Mapped agencies (${agencyIds.length})`}>
              <div className="max-h-60 space-y-1 overflow-y-auto rounded-md border bg-surface-2 p-2">
                {(agencies.data?.data ?? []).map((a) => {
                  const active = agencyIds.includes(a.id);
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => toggleAgency(a.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition',
                        active ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-surface-1',
                      )}
                    >
                      <span>
                        <span className="block">{a.companyName}</span>
                        <span className="block font-mono text-[10px] text-ink-3">{a.agencyCode}</span>
                      </span>
                      <span className={cn('font-mono text-xs', active ? 'text-accent' : 'text-ink-4')}>
                        {active ? '✓' : '+'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </FormField>

            <FormField label={`Mapped airlines (${airlineCodes.length})`} hint="optional">
              <div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto rounded-md border bg-surface-2 p-2">
                {AIRLINES.map((a) => {
                  const active = airlineCodes.includes(a.code);
                  return (
                    <button
                      type="button"
                      key={a.code}
                      onClick={() => toggleAirline(a.code)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition',
                        active
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-2 bg-surface-1 text-ink-2 hover:bg-surface-2',
                      )}
                    >
                      {a.name}
                      <span className="ml-1 font-mono text-[10px] text-ink-4">{a.code}</span>
                    </button>
                  );
                })}
              </div>
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create group'}
            </Button>
          </DialogFooter>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
