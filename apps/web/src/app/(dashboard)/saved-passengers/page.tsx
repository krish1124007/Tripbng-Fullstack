'use client';

// Saved passengers — agency-shared traveler directory.
//
// Backed by /api/v1/saved-passengers (CRUD, per-agency scope). The
// booking form's "Search saved passengers" autofill pulls from the
// same store, so anything an agent adds here is reusable across the
// agency.
//
// This page is the directory's full CRUD surface:
//   • KPI strip — Total / By type / With passport / Passports
//     expiring soon (next 6 months)
//   • Type chip filter + search + grid / list view toggle + sort
//   • Bulk select with delete + CSV export
//   • Add + Edit drawer
//   • Per-row passport expiry pill that turns warning < 6mo, danger
//     when expired
//   • Empty states tuned per filter

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Baby,
  Check,
  FileSpreadsheet,
  Mail,
  Pencil,
  Phone,
  Plus,
  Rows3,
  Search,
  ShieldCheck,
  StickyNote,
  Table as TableIcon,
  Trash2,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  PublicSavedPassenger,
  SavedPassengerCreate,
  SavedPassengerListResponse,
  SavedPassengerUpdate,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui';
import { useApiMutation, useApiQuery } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'ADULT' | 'CHILD' | 'INFANT';
type SortKey = 'updated' | 'name' | 'expiry';
type ViewMode = 'grid' | 'list';

const TYPE_META: Record<
  'ADULT' | 'CHILD' | 'INFANT',
  { label: string; tone: 'brand' | 'accent' | 'success'; icon: typeof UserIcon; range: string }
> = {
  ADULT: { label: 'Adult', tone: 'brand', icon: UserIcon, range: '12+' },
  CHILD: { label: 'Child', tone: 'accent', icon: UserIcon, range: '2–11' },
  INFANT: { label: 'Infant', tone: 'success', icon: Baby, range: 'Under 2' },
};

/** Months between two dates (signed — negative when expiry is past). */
function monthsUntil(iso: string): number {
  const now = new Date();
  const expiry = new Date(iso);
  return (expiry.getFullYear() - now.getFullYear()) * 12 + (expiry.getMonth() - now.getMonth());
}

function passportFreshness(iso: string | null | undefined): {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  label: string;
} | null {
  if (!iso) return null;
  const m = monthsUntil(iso);
  if (m < 0) return { tone: 'danger', label: 'Expired' };
  if (m < 6) return { tone: 'warning', label: `Expires in ${m}mo` };
  return { tone: 'success', label: `Valid · ${m}mo left` };
}

export default function SavedPassengersPage() {
  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>('grid');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PublicSavedPassenger | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const list = useApiQuery<SavedPassengerListResponse>(
    ['saved-passengers', typeFilter, q],
    '/api/v1/saved-passengers',
    {
      query: {
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
      },
      staleTime: 30_000,
    },
  );
  const items = list.data?.items ?? [];

  // ── Mutations ──
  const createMut = useApiMutation<SavedPassengerCreate, PublicSavedPassenger>(
    '/api/v1/saved-passengers',
    'POST',
    {
      onSuccess: () => {
        toast.success('Passenger saved');
        setCreateOpen(false);
        void list.refetch();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const updateMut = useApiMutation<
    { id: string; patch: SavedPassengerUpdate },
    PublicSavedPassenger
  >((i) => `/api/v1/saved-passengers/${i.id}`, 'PATCH', {
    onSuccess: () => {
      toast.success('Passenger updated');
      setEditTarget(null);
      void list.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMut = useApiMutation<{ id: string }, { id: string }>(
    (input) => `/api/v1/saved-passengers/${input.id}`,
    'DELETE',
    {
      onSuccess: () => {
        toast.success('Passenger removed');
        setDeleteId(null);
        void list.refetch();
      },
      onError: (err) => {
        toast.error(err.message);
        setDeleteId(null);
      },
    },
  );

  // ── Derived: KPIs ──
  const kpis = useMemo(() => {
    let adult = 0;
    let child = 0;
    let infant = 0;
    let withPassport = 0;
    let expiringSoon = 0;
    let expired = 0;
    for (const p of items) {
      if (p.type === 'ADULT') adult += 1;
      else if (p.type === 'CHILD') child += 1;
      else infant += 1;
      if (p.passport?.number) {
        withPassport += 1;
        if (p.passport.expiry) {
          const m = monthsUntil(p.passport.expiry);
          if (m < 0) expired += 1;
          else if (m < 6) expiringSoon += 1;
        }
      }
    }
    return { total: items.length, adult, child, infant, withPassport, expiringSoon, expired };
  }, [items]);

  // ── Sorted + view list ──
  const sorted = useMemo(() => {
    const arr = [...items];
    if (sort === 'name') {
      arr.sort((a, b) => `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`));
    } else if (sort === 'expiry') {
      arr.sort((a, b) => {
        const ae = a.passport?.expiry ? new Date(a.passport.expiry).getTime() : Infinity;
        const be = b.passport?.expiry ? new Date(b.passport.expiry).getTime() : Infinity;
        return ae - be;
      });
    } else {
      // 'updated' — server already returns sorted by updatedAt DESC.
    }
    return arr;
  }, [items, sort]);

  // Reset bulk-select when filters change so ids can't go stale.
  useEffect(() => {
    setBulkSelected(new Set());
  }, [typeFilter, q, sort]);

  const togglePick = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const pickAllVisible = () => {
    setBulkSelected(new Set(sorted.map((p) => p.id)));
  };

  // CSV — uses the currently sorted/filtered slice.
  const downloadCsv = () => {
    const header = [
      'type',
      'title',
      'firstName',
      'lastName',
      'dateOfBirth',
      'gender',
      'nationality',
      'passportNumber',
      'passportExpiry',
      'passportIssuingCountry',
      'email',
      'phone',
    ];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = sorted.map((p) =>
      [
        p.type,
        p.title,
        p.firstName,
        p.lastName,
        p.dateOfBirth ?? '',
        p.gender ?? '',
        p.nationality ?? '',
        p.passport?.number ?? '',
        p.passport?.expiry ?? '',
        p.passport?.issuingCountry ?? '',
        p.email ?? '',
        p.phone ?? '',
      ]
        .map((c) => esc(String(c)))
        .join(','),
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tripbng-passengers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const bulkDelete = async () => {
    const ids = Array.from(bulkSelected);
    setBulkConfirmOpen(false);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await deleteMut.mutateAsync({ id });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    toast.success(`${ok} removed${fail > 0 ? `, ${fail} failed` : ''}`);
    setBulkSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate · Directory"
        title="Saved passengers"
        description="Agency-shared passenger directory. Appears in the booking form's autofill for every team member."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadCsv} disabled={sorted.length === 0}>
              <FileSpreadsheet className="h-4 w-4" /> CSV
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Add passenger
            </Button>
          </div>
        }
      />

      {/* ─────────── KPI strip ─────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-4 w-4" />}
          tone="brand"
          label="Total passengers"
          value={String(kpis.total)}
          subValue={`${kpis.adult} adult · ${kpis.child} child · ${kpis.infant} infant`}
          loading={list.isLoading}
        />
        <KpiCard
          icon={<StickyNote className="h-4 w-4" />}
          tone="success"
          label="With passport"
          value={String(kpis.withPassport)}
          subValue={
            kpis.total > 0
              ? `${Math.round((kpis.withPassport / kpis.total) * 100)}% of directory`
              : '—'
          }
          loading={list.isLoading}
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warning"
          label="Expiring soon"
          value={String(kpis.expiringSoon)}
          subValue="within 6 months"
          loading={list.isLoading}
          highlight={kpis.expiringSoon > 0}
        />
        <KpiCard
          icon={<X className="h-4 w-4" />}
          tone="danger"
          label="Expired passports"
          value={String(kpis.expired)}
          subValue={kpis.expired === 0 ? 'all good' : 'block international fares'}
          loading={list.isLoading}
          highlight={kpis.expired > 0}
        />
      </section>

      {/* ─────────── Toolbar ─────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Input
          placeholder="Search by name, email, phone, passport…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          leading={<Search className="h-4 w-4" strokeWidth={1.75} />}
          className="h-8 w-full max-w-xs"
          fullWidth={false}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        {(['all', 'ADULT', 'CHILD', 'INFANT'] as FilterType[]).map((t) => {
          const count =
            t === 'all'
              ? kpis.total
              : t === 'ADULT'
                ? kpis.adult
                : t === 'CHILD'
                  ? kpis.child
                  : kpis.infant;
          return (
            <FilterChip
              key={t}
              active={typeFilter === t}
              onClick={() => setTypeFilter(t)}
              label={`${t === 'all' ? 'All' : TYPE_META[t]?.label ?? t} · ${count}`}
            />
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Recently updated</SelectItem>
              <SelectItem value="name">A → Z by name</SelectItem>
              <SelectItem value="expiry">Passport expiry</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              aria-label="Grid view"
              className={cn(
                'grid h-7 w-7 place-items-center rounded transition-colors',
                view === 'grid'
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-ink-3 hover:bg-surface-2',
              )}
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-label="List view"
              className={cn(
                'grid h-7 w-7 place-items-center rounded transition-colors',
                view === 'list'
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'text-ink-3 hover:bg-surface-2',
              )}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ─────────── Bulk action toolbar ─────────── */}
      {bulkSelected.size > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-brand-500/40 bg-brand-50/60 px-4 py-2.5 dark:bg-brand-500/10">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-brand-700 dark:text-brand-300" />
            <span className="font-semibold text-ink-1">
              {bulkSelected.size} passenger{bulkSelected.size === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={pickAllVisible}>
              Select all visible ({sorted.length})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setBulkSelected(new Set())}>
              Clear
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setBulkConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove selected
            </Button>
          </div>
        </div>
      ) : null}

      {/* ─────────── Content ─────────── */}
      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="p-8">
            <EmptyState
              icon={Users}
              title={
                q || typeFilter !== 'all'
                  ? 'No matching passengers'
                  : 'No saved passengers yet'
              }
              description={
                q || typeFilter !== 'all'
                  ? 'Try a different search or clear the filters.'
                  : 'Save passengers from the booking form (tick "Save passenger") or add one manually.'
              }
              action={
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add passenger
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((p) => (
            <PassengerCard
              key={p.id}
              p={p}
              selected={bulkSelected.has(p.id)}
              onToggle={() => togglePick(p.id)}
              onEdit={() => setEditTarget(p)}
              onDelete={() => setDeleteId(p.id)}
            />
          ))}
        </div>
      ) : (
        <PassengerTable
          rows={sorted}
          selected={bulkSelected}
          onToggle={togglePick}
          onEdit={setEditTarget}
          onDelete={(id) => setDeleteId(id)}
        />
      )}

      {/* ─────────── Dialogs ─────────── */}
      <PassengerDialog
        mode="create"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={(body) => createMut.mutate(body)}
        saving={createMut.isPending}
      />
      <PassengerDialog
        mode="edit"
        target={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSave={(body) => {
          if (editTarget) updateMut.mutate({ id: editTarget.id, patch: body });
        }}
        saving={updateMut.isPending}
      />

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(v) => !v && setDeleteId(null)}
        title="Remove saved passenger?"
        description="They'll no longer appear in the booking form's autofill. Existing bookings keep their records — only the directory entry is removed."
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (deleteId) deleteMut.mutate({ id: deleteId });
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        title={`Remove ${bulkSelected.size} passengers?`}
        description="They'll no longer appear in the booking form's autofill. Existing bookings keep their records — only the directory entries are removed."
        confirmLabel="Remove all"
        destructive
        onConfirm={bulkDelete}
      />
    </div>
  );
}

// ─────────── Sub-components ───────────

function KpiCard({
  icon,
  tone,
  label,
  value,
  subValue,
  loading,
  highlight,
}: {
  icon: React.ReactNode;
  tone: 'brand' | 'success' | 'warning' | 'danger';
  label: string;
  value: string;
  subValue?: string;
  loading?: boolean;
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-shadow',
        highlight && tone === 'warning' && 'border-warning/40 shadow-md',
        highlight && tone === 'danger' && 'border-danger/40 shadow-md',
      )}
    >
      {highlight ? (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full blur-2xl',
            tone === 'warning' && 'bg-warning/20',
            tone === 'danger' && 'bg-danger/20',
          )}
        />
      ) : null}
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-3">{label}</p>
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-md',
              tone === 'brand' && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15',
              tone === 'success' && 'bg-success-soft text-success',
              tone === 'warning' && 'bg-warning-soft text-warning',
              tone === 'danger' && 'bg-danger-soft text-danger',
            )}
          >
            {icon}
          </span>
        </div>
        <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink-1">
          {loading ? <Skeleton className="h-7 w-12" /> : value}
        </p>
        {subValue ? <p className="mt-0.5 text-[10px] text-ink-4">{subValue}</p> : null}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

function PassengerCard({
  p,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  p: PublicSavedPassenger;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const meta = TYPE_META[p.type];
  const Icon = meta.icon;
  const expiry = passportFreshness(p.passport?.expiry);
  return (
    <Card
      className={cn(
        'group relative transition-all duration-fast',
        selected && 'border-brand-500 ring-2 ring-brand-300/40',
      )}
    >
      <CardContent className="space-y-3 p-4">
        {/* Top row — checkbox + identity + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="mt-1.5 h-3.5 w-3.5 cursor-pointer rounded border-strong text-brand-500 focus:ring-1 focus:ring-brand-300"
              aria-label="Select"
            />
            <span
              className={cn(
                'mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md',
                meta.tone === 'brand' &&
                  'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
                meta.tone === 'accent' && 'bg-accent-50 text-accent-700 dark:bg-accent-500/15',
                meta.tone === 'success' && 'bg-success-soft text-success',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink-1">
                {p.title}. {p.firstName} {p.lastName}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-ink-3">
                {meta.label} · {meta.range}
                {p.gender ? ` · ${p.gender === 'M' ? 'Male' : 'Female'}` : ''}
                {p.dateOfBirth
                  ? ` · DOB ${new Date(p.dateOfBirth + 'T00:00:00').toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}`
                  : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label="Edit"
              className="h-7 w-7"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              aria-label="Remove"
              className="h-7 w-7 text-danger hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Passport pill */}
        {p.passport?.number ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 font-mono text-[10px]">
              <ShieldCheck className="h-3 w-3" />
              {p.passport.number}
            </Badge>
            {expiry ? (
              <Badge
                variant={
                  expiry.tone === 'success'
                    ? 'success'
                    : expiry.tone === 'warning'
                      ? 'warning'
                      : expiry.tone === 'danger'
                        ? 'danger'
                        : 'neutral'
                }
                className="text-[10px]"
              >
                {expiry.label}
              </Badge>
            ) : null}
            {p.passport.issuingCountry ? (
              <span className="font-mono text-[10px] text-ink-4">
                {p.passport.issuingCountry}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Contact row */}
        {p.email || p.phone ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
            {p.email ? (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="h-3 w-3" strokeWidth={1.75} />
                <span className="truncate">{p.email}</span>
              </span>
            ) : null}
            {p.phone ? (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" strokeWidth={1.75} />
                {p.phone}
              </span>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PassengerTable({
  rows,
  selected,
  onToggle,
  onEdit,
  onDelete,
}: {
  rows: PublicSavedPassenger[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (p: PublicSavedPassenger) => void;
  onDelete: (id: string) => void;
}) {
  const columns: ColumnDef<PublicSavedPassenger, unknown>[] = [
    {
      id: 'pick',
      header: () => null,
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selected.has(row.original.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggle(row.original.id)}
          className="h-3.5 w-3.5 cursor-pointer rounded border-strong text-brand-500 focus:ring-1 focus:ring-brand-300"
          aria-label="Select"
        />
      ),
    },
    {
      header: 'Passenger',
      cell: ({ row }) => {
        const p = row.original;
        const meta = TYPE_META[p.type];
        const Icon = meta.icon;
        return (
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-md',
                meta.tone === 'brand' && 'bg-brand-50 text-brand-700',
                meta.tone === 'accent' && 'bg-accent-50 text-accent-700',
                meta.tone === 'success' && 'bg-success-soft text-success',
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-1">
                {p.title}. {p.firstName} {p.lastName}
              </p>
              <p className="font-mono text-[10px] text-ink-3">
                {meta.label} · {meta.range}
                {p.gender ? ` · ${p.gender}` : ''}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Passport',
      cell: ({ row }) => {
        const p = row.original;
        if (!p.passport?.number)
          return <span className="text-[11px] text-ink-4">—</span>;
        const exp = passportFreshness(p.passport.expiry);
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-1">{p.passport.number}</span>
            {exp ? (
              <Badge
                variant={exp.tone === 'success' ? 'success' : exp.tone === 'warning' ? 'warning' : exp.tone === 'danger' ? 'danger' : 'neutral'}
                className="text-[9px]"
              >
                {exp.label}
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      header: 'Contact',
      cell: ({ row }) => (
        <div className="space-y-0.5 text-[11px] text-ink-2">
          {row.original.email ? <p className="truncate">{row.original.email}</p> : null}
          {row.original.phone ? (
            <p className="font-mono text-ink-3">{row.original.phone}</p>
          ) : null}
          {!row.original.email && !row.original.phone ? (
            <span className="text-ink-4">—</span>
          ) : null}
        </div>
      ),
    },
    {
      header: 'Updated',
      cell: ({ row }) => (
        <span className="font-mono text-[10px] text-ink-4">
          {new Date(row.original.updatedAt).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}
        </span>
      ),
    },
    {
      header: '',
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(row.original)}
            aria-label="Edit"
            className="h-7 w-7"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(row.original.id)}
            aria-label="Remove"
            className="h-7 w-7 text-danger hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];
  return (
    <Card className="overflow-hidden p-0">
      <DataTable columns={columns} data={rows} loading={false} density="default" empty="" />
    </Card>
  );
}

// ─────────── Create / Edit dialog ───────────

interface CreateForm {
  type: 'ADULT' | 'CHILD' | 'INFANT';
  title: 'MR' | 'MRS' | 'MS' | 'MSTR' | 'MISS';
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'M' | 'F' | '';
  nationality: string;
  passportNumber: string;
  passportExpiry: string;
  passportIssuingCountry: string;
  email: string;
  phone: string;
}

const EMPTY_FORM: CreateForm = {
  type: 'ADULT',
  title: 'MR',
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: '',
  nationality: '',
  passportNumber: '',
  passportExpiry: '',
  passportIssuingCountry: '',
  email: '',
  phone: '',
};

function passengerToForm(p: PublicSavedPassenger): CreateForm {
  return {
    type: p.type,
    title: p.title,
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth ?? '',
    gender: (p.gender as 'M' | 'F' | null) ?? '',
    nationality: p.nationality ?? '',
    passportNumber: p.passport?.number ?? '',
    passportExpiry: p.passport?.expiry ?? '',
    passportIssuingCountry: p.passport?.issuingCountry ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
  };
}

function PassengerDialog({
  mode,
  target,
  open,
  onClose,
  onSave,
  saving,
}: {
  mode: 'create' | 'edit';
  target?: PublicSavedPassenger | null;
  open: boolean;
  onClose: () => void;
  onSave: (body: SavedPassengerCreate) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);

  // Hydrate form when opening in edit mode; reset on close.
  useEffect(() => {
    if (!open) return;
    setForm(mode === 'edit' && target ? passengerToForm(target) : EMPTY_FORM);
  }, [open, mode, target]);

  function update<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First name and last name are required');
      return;
    }
    const body: SavedPassengerCreate = {
      type: form.type,
      title: form.title,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      nationality: form.nationality || undefined,
      passport:
        form.passportNumber && form.passportExpiry && form.passportIssuingCountry
          ? {
              number: form.passportNumber,
              expiry: form.passportExpiry,
              issuingCountry: form.passportIssuingCountry.toUpperCase(),
            }
          : undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
    };
    onSave(body);
  }

  const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || 'New passenger';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? `Edit ${fullName}` : 'Add passenger'}</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* Live preview header */}
          <div className="flex items-center gap-3 rounded-md border bg-surface-2/30 p-3">
            <span
              className={cn(
                'grid h-10 w-10 place-items-center rounded-md',
                form.type === 'ADULT' && 'bg-brand-50 text-brand-700',
                form.type === 'CHILD' && 'bg-accent-50 text-accent-700',
                form.type === 'INFANT' && 'bg-success-soft text-success',
              )}
            >
              {form.type === 'INFANT' ? (
                <Baby className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <UserIcon className="h-4 w-4" strokeWidth={1.75} />
              )}
            </span>
            <div>
              <p className="text-sm font-bold text-ink-1">
                {form.title}. {fullName}
              </p>
              <p className="font-mono text-[10px] text-ink-3">
                {TYPE_META[form.type].label} · {TYPE_META[form.type].range}
                {form.gender ? ` · ${form.gender === 'M' ? 'Male' : 'Female'}` : ''}
                {form.dateOfBirth ? ` · DOB ${form.dateOfBirth}` : ''}
              </p>
            </div>
          </div>

          {/* Type + title */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => update('type', v as CreateForm['type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADULT">Adult (12+)</SelectItem>
                  <SelectItem value="CHILD">Child (2–11)</SelectItem>
                  <SelectItem value="INFANT">Infant (under 2)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Title</Label>
              <Select
                value={form.title}
                onValueChange={(v) => update('title', v as CreateForm['title'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['MR', 'MRS', 'MS', 'MSTR', 'MISS'] as const).map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Names */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name *</Label>
              <Input
                value={form.firstName}
                onChange={(e) => update('firstName', e.target.value)}
                placeholder="As on ID"
              />
            </div>
            <div>
              <Label>Last name *</Label>
              <Input
                value={form.lastName}
                onChange={(e) => update('lastName', e.target.value)}
                placeholder="As on ID"
              />
            </div>
          </div>

          {/* DOB + gender */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Date of birth</Label>
              <Input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => update('dateOfBirth', e.target.value)}
              />
            </div>
            <div>
              <Label>Gender</Label>
              <Select
                value={form.gender || 'unset'}
                onValueChange={(v) =>
                  update('gender', v === 'unset' ? '' : (v as 'M' | 'F'))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not specified" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not specified</SelectItem>
                  <SelectItem value="M">Male</SelectItem>
                  <SelectItem value="F">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Passport */}
          <div className="rounded-md border border-dashed border-stroke-1 bg-surface-2/30 p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Passport (optional — required for international fares)
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Number</Label>
                <Input
                  value={form.passportNumber}
                  onChange={(e) => update('passportNumber', e.target.value.toUpperCase())}
                  placeholder="A1234567"
                />
              </div>
              <div>
                <Label>Expiry</Label>
                <Input
                  type="date"
                  value={form.passportExpiry}
                  onChange={(e) => update('passportExpiry', e.target.value)}
                />
              </div>
              <div>
                <Label>Issuing country (ISO-2)</Label>
                <Input
                  value={form.passportIssuingCountry}
                  onChange={(e) =>
                    update(
                      'passportIssuingCountry',
                      e.target.value.toUpperCase().slice(0, 2),
                    )
                  }
                  placeholder="IN"
                  maxLength={2}
                />
              </div>
            </div>
            {form.passportExpiry ? (
              <p className="mt-2 text-[10px] text-ink-3">
                {(() => {
                  const f = passportFreshness(form.passportExpiry);
                  if (!f) return null;
                  return (
                    <span
                      className={cn(
                        f.tone === 'danger' && 'text-danger',
                        f.tone === 'warning' && 'text-warning',
                        f.tone === 'success' && 'text-success',
                      )}
                    >
                      {f.label}
                    </span>
                  );
                })()}
              </p>
            ) : null}
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="contact@example.com"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="+91 9XXX-XXXXXX"
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {mode === 'edit' ? (
              <>
                <Check className="h-3.5 w-3.5" /> Save changes
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" /> Save passenger
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
