'use client';

// /topups — financial ops cockpit.
//
// Two role-aware views off the SAME endpoint:
//   - SUPER_ADMIN / ACCOUNTS_USER: approval queue with bulk approve,
//     trend chart, time-since urgency markers, detail drawer.
//   - AGENCY / SUB_AGENT / DISTRIBUTOR: read-only history of own
//     top-ups with the "Request top-up" CTA inlined.
//
// All KPIs + the trend chart are derived client-side from the loaded
// list — zero new API calls. Auto-refresh every 30s catches new
// pending submissions without a manual reload.

import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Check,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Hourglass,
  Inbox,
  Landmark,
  PiggyBank,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PublicTopupRequest } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { EarningsTrendChart } from '@/components/charts';
import { useApiMutation, useApiQuery, useInvalidateOnSuccess } from '@/lib/api-client';
import { formatPaiseAsINR } from '@/lib/money';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { TopupDialog } from '../wallet/_topup-dialog';

type StatusFilter = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
type ModeFilter = 'all' | 'BANK' | 'UPI' | 'CASH' | 'GATEWAY';

const PAYMENT_MODE_META: Record<
  string,
  { label: string; icon: typeof Landmark; tone: 'brand' | 'success' | 'accent' | 'neutral' }
> = {
  BANK: { label: 'Bank', icon: Landmark, tone: 'brand' },
  UPI: { label: 'UPI', icon: Smartphone, tone: 'success' },
  CASH: { label: 'Cash', icon: Banknote, tone: 'accent' },
  GATEWAY: { label: 'Gateway', icon: PiggyBank, tone: 'brand' },
};

const STATUS_META: Record<
  string,
  { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: typeof Check }
> = {
  PENDING: { label: 'Pending', tone: 'warning', icon: Hourglass },
  APPROVED: { label: 'Approved', tone: 'success', icon: Check },
  REJECTED: { label: 'Rejected', tone: 'danger', icon: XCircle },
  EXPIRED: { label: 'Expired', tone: 'neutral', icon: Clock },
};

/** Human-friendly "2h ago", "3d ago" labels. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default function TopupsPage() {
  const me = useAuthStore((s) => s.user);
  const isAdmin = me?.role === 'SUPER_ADMIN' || me?.role === 'ACCOUNTS_USER';

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(isAdmin ? 'PENDING' : 'all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [search, setSearch] = useState('');

  // Dialog state
  const [approveTarget, setApproveTarget] = useState<PublicTopupRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PublicTopupRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<PublicTopupRequest | null>(null);

  // Bulk select
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // The list endpoint already returns the role-scoped data — agencies
  // get their own, distributors get downline, admins get everything.
  // We always pull the FULL list (server caps at 200) and filter on
  // the client so the KPI strip + chart stay consistent with the
  // table while filters toggle.
  const list = useApiQuery<PublicTopupRequest[]>(['topups', 'all'], '/api/v1/wallet/topups', {
    // Auto-refresh every 30s so the admin queue picks up new
    // submissions without a manual reload.
    refetchInterval: 30_000,
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);

  const invalidate = useInvalidateOnSuccess([['topups'], ['wallet']]);
  const approve = useApiMutation<{ id: string }, PublicTopupRequest>(
    (i) => `/api/v1/wallet/topups/${i.id}/approve`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Top-up approved & posted to ledger');
        invalidate();
      },
      onError: (err) => toast.error(err.message),
    },
  );
  const reject = useApiMutation<{ id: string; reason: string }, PublicTopupRequest>(
    (i) => `/api/v1/wallet/topups/${i.id}/reject`,
    'POST',
    {
      onSuccess: () => {
        toast.success('Top-up rejected');
        invalidate();
        setRejectReason('');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  // ── Derived: KPI strip ──
  const kpis = useMemo(() => {
    const monthStart = startOfMonth().getTime();
    let pendingCount = 0;
    let pendingPaise = 0;
    let approvedCount = 0;
    let approvedPaise = 0;
    let rejectedCount = 0;
    let totalApproved = 0;
    let totalDecided = 0; // approved + rejected (this month)
    for (const r of rows) {
      const t = new Date(r.createdAt).getTime();
      if (r.status === 'PENDING') {
        pendingCount += 1;
        pendingPaise += r.amountPaise;
      }
      if (t >= monthStart) {
        if (r.status === 'APPROVED') {
          approvedCount += 1;
          approvedPaise += r.amountPaise;
          totalDecided += 1;
        } else if (r.status === 'REJECTED') {
          rejectedCount += 1;
          totalDecided += 1;
        }
      }
      if (r.status === 'APPROVED') totalApproved += 1;
    }
    const approvalRate = totalDecided > 0 ? (approvedCount / totalDecided) * 100 : null;
    return {
      pendingCount,
      pendingPaise,
      approvedCount,
      approvedPaise,
      rejectedCount,
      approvalRate,
    };
  }, [rows]);

  // ── Derived: 30-day approved volume trend ──
  const trend = useMemo(() => {
    if (rows.length === 0) return [] as { day: string; earningsPaise: number }[];
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    const byDay = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== 'APPROVED') continue;
      const t = new Date(r.createdAt);
      if (t < start) continue;
      const iso = t.toISOString().slice(0, 10);
      byDay.set(iso, (byDay.get(iso) ?? 0) + r.amountPaise);
    }
    const out: { day: string; earningsPaise: number }[] = [];
    for (let cur = new Date(start); cur <= new Date(); cur.setDate(cur.getDate() + 1)) {
      const iso = cur.toISOString().slice(0, 10);
      out.push({ day: iso, earningsPaise: byDay.get(iso) ?? 0 });
    }
    return out;
  }, [rows]);

  // ── Filtered + searched list ──
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (modeFilter !== 'all' && r.paymentMode !== modeFilter) return false;
      if (needle) {
        const hay = [
          r.referenceNumber ?? '',
          r.agencyName ?? '',
          r.distributorName ?? '',
          r.agencyCode ?? '',
          r.distributorCode ?? '',
          String(r.amountPaise / 100),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, modeFilter, search]);

  // Reset bulk selection whenever the filter set changes — selected
  // ids might no longer be in view.
  useEffect(() => {
    setBulkSelected(new Set());
  }, [statusFilter, modeFilter, search]);

  // CSV export — uses the currently filtered slice so the file
  // matches what the user sees.
  const downloadCsv = () => {
    const header = [
      'createdAt',
      'status',
      'paymentMode',
      'agency',
      'agencyCode',
      'distributor',
      'reference',
      'amount_inr',
      'notes',
    ];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = filtered.map((r) =>
      [
        new Date(r.createdAt).toISOString(),
        r.status,
        r.paymentMode,
        r.agencyName ?? '',
        r.agencyCode ?? '',
        r.distributorName ?? '',
        r.referenceNumber ?? '',
        (r.amountPaise / 100).toFixed(2),
        r.notes ?? '',
      ]
        .map((c) => esc(String(c)))
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tripbng-topups-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const togglePick = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Day grouping for the table — keeps a tidy "Today / Yesterday /
  // 21 May 2026" header above each cluster.
  const grouped = useMemo(() => {
    const groups: Array<{ day: string; rows: PublicTopupRequest[] }> = [];
    const today = new Date().toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const yest = new Date(Date.now() - 86_400_000).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    for (const r of filtered) {
      const d = new Date(r.createdAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      const label = d === today ? 'Today' : d === yest ? 'Yesterday' : d;
      let bucket = groups.find((g) => g.day === label);
      if (!bucket) {
        bucket = { day: label, rows: [] };
        groups.push(bucket);
      }
      bucket.rows.push(r);
    }
    return groups;
  }, [filtered]);

  const columns = useMemo<ColumnDef<PublicTopupRequest, unknown>[]>(
    () => [
      // Bulk-select checkbox column — only meaningful for admins on the
      // pending filter. We always render the column to keep the table
      // header alignment stable; cells render an empty span when the
      // row isn't actionable.
      ...(isAdmin
        ? [
            {
              header: () => null,
              id: 'pick',
              cell: ({ row }: { row: { original: PublicTopupRequest } }) => {
                if (row.original.status !== 'PENDING') return <span />;
                const checked = bulkSelected.has(row.original.id);
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => togglePick(row.original.id)}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-strong text-brand-500 focus:ring-1 focus:ring-brand-300"
                    aria-label="Select for bulk action"
                  />
                );
              },
            } as ColumnDef<PublicTopupRequest, unknown>,
          ]
        : []),
      {
        header: 'Account',
        cell: ({ row }) => {
          const r = row.original;
          const isUrgent =
            r.status === 'PENDING' && Date.now() - new Date(r.createdAt).getTime() > 60 * 60_000;
          return (
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                <Building2 className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold text-ink-1">
                    {r.agencyName ?? r.distributorName ?? '—'}
                  </p>
                  {isUrgent ? (
                    <span
                      className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-danger"
                      title="Pending over 1 hour"
                    />
                  ) : null}
                </div>
                <p className="font-mono text-[10px] text-ink-3">
                  {r.agencyCode ?? r.distributorCode ?? '—'}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        header: 'Mode',
        accessorKey: 'paymentMode',
        cell: ({ getValue }) => {
          const m = getValue() as string;
          const meta = PAYMENT_MODE_META[m] ?? PAYMENT_MODE_META.BANK!;
          const Icon = meta.icon;
          return (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded',
                  meta.tone === 'brand' && 'bg-brand-50 text-brand-700',
                  meta.tone === 'success' && 'bg-success-soft text-success',
                  meta.tone === 'accent' && 'bg-accent-50 text-accent-700',
                  meta.tone === 'neutral' && 'bg-surface-2 text-ink-3',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <span className="text-xs font-medium text-ink-2">{meta.label}</span>
            </div>
          );
        },
      },
      {
        header: 'Reference',
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-mono text-xs text-ink-1">
              {row.original.referenceNumber ?? '—'}
            </p>
            <p className="font-mono text-[10px] text-ink-4">{timeAgo(row.original.createdAt)}</p>
          </div>
        ),
      },
      {
        header: 'Amount',
        accessorKey: 'amountPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm font-semibold tabular-nums text-ink-1">
            {formatPaiseAsINR(getValue() as number)}
          </span>
        ),
      },
      {
        header: 'Status',
        accessorKey: 'status',
        cell: ({ getValue }) => {
          const s = getValue() as string;
          const meta = STATUS_META[s] ?? STATUS_META.PENDING!;
          const Icon = meta.icon;
          return (
            <Badge variant={meta.tone === 'neutral' ? 'neutral' : meta.tone} className="gap-1">
              <Icon className="h-3 w-3" strokeWidth={2} />
              {meta.label}
            </Badge>
          );
        },
      },
      {
        header: '',
        id: 'actions',
        cell: ({ row }) => {
          const r = row.original;
          if (r.status !== 'PENDING' || !isAdmin) {
            return r.proofUrl ? (
              <div className="flex justify-end">
                <a
                  href={r.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 rounded-md border bg-surface-2 px-2 py-1 text-[10px] font-medium text-ink-2 transition-colors hover:bg-surface-1"
                >
                  Proof <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ) : (
              <span />
            );
          }
          return (
            <div
              className="flex justify-end gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {r.proofUrl ? (
                <a
                  href={r.proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border bg-surface-2 px-2 py-1 text-[10px] font-medium text-ink-2 transition-colors hover:bg-surface-1"
                >
                  Proof
                </a>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRejectTarget(r)}
                className="h-7 px-2 text-danger hover:bg-danger-soft hover:text-danger"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
              <Button size="sm" onClick={() => setApproveTarget(r)} className="h-7 px-2">
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
            </div>
          );
        },
      },
    ],
    [isAdmin, bulkSelected],
  );

  // Bulk approve — chain mutations sequentially so the wallet doc
  // sees one credit at a time (no race on the optimistic-counter).
  const bulkApproveAll = async () => {
    const ids = Array.from(bulkSelected);
    setBulkConfirmOpen(false);
    let okCount = 0;
    let failCount = 0;
    for (const id of ids) {
      try {
        await approve.mutateAsync({ id });
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    toast.success(
      `${okCount} approved${failCount > 0 ? `, ${failCount} failed` : ''}`,
    );
    setBulkSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance · Wallet ops"
        title={isAdmin ? 'Top-up approvals' : 'Top-up history'}
        description={
          isAdmin
            ? 'Manual top-ups awaiting verification. Approving posts an immutable ledger credit.'
            : 'Your past top-up requests. Gateway top-ups clear instantly; manual modes wait on admin.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadCsv} disabled={filtered.length === 0}>
              <FileSpreadsheet className="h-4 w-4" /> CSV
            </Button>
            {!isAdmin ? (
              <Button onClick={() => setRequestOpen(true)}>
                <Plus className="h-4 w-4" /> Request top-up
              </Button>
            ) : null}
          </div>
        }
      />

      {/* ─────────── KPI strip ─────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Hourglass className="h-4 w-4" />}
          tone="warning"
          label="Pending"
          value={String(kpis.pendingCount)}
          subValue={formatPaiseAsINR(kpis.pendingPaise, { compact: true })}
          loading={list.isLoading}
          highlight={kpis.pendingCount > 0 && isAdmin}
        />
        <KpiCard
          icon={<Check className="h-4 w-4" />}
          tone="success"
          label="Approved this month"
          value={String(kpis.approvedCount)}
          subValue={formatPaiseAsINR(kpis.approvedPaise, { compact: true })}
          loading={list.isLoading}
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4" />}
          tone="danger"
          label="Rejected this month"
          value={String(kpis.rejectedCount)}
          subValue={kpis.rejectedCount === 0 ? '—' : 'see history'}
          loading={list.isLoading}
        />
        <KpiCard
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="brand"
          label="Approval rate"
          value={
            kpis.approvalRate == null ? '—' : `${Math.round(kpis.approvalRate)}%`
          }
          subValue="last 30 days"
          loading={list.isLoading}
        />
      </section>

      {/* ─────────── Trend chart (admins only) ─────────── */}
      {isAdmin ? (
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-ink-3">
                  <TrendingUp className="h-3 w-3" /> Approved top-up volume
                </p>
                <p className="mt-1 text-sm font-semibold text-ink-1">Last 30 days</p>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                {formatPaiseAsINR(
                  trend.reduce((sum, p) => sum + p.earningsPaise, 0),
                  { compact: true },
                )}
              </Badge>
            </div>
            {list.isLoading ? (
              <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
            ) : trend.length > 0 ? (
              <EarningsTrendChart data={trend} />
            ) : (
              <div className="grid h-[220px] place-items-center rounded-md border border-dashed text-xs text-ink-3">
                No approved top-ups in this window
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ─────────── Filter bar ─────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Input
          placeholder="Search reference, agency, amount…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leading={<Search className="h-4 w-4" strokeWidth={1.75} />}
          className="h-8 w-full max-w-xs"
          fullWidth={false}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        {(['all', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as StatusFilter[]).map(
          (s) => (
            <FilterChip
              key={s}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
              label={s === 'all' ? 'All' : STATUS_META[s]?.label ?? s}
            />
          ),
        )}
        <div className="mx-1 h-5 w-px bg-border" />
        {(['all', 'BANK', 'UPI', 'CASH'] as ModeFilter[]).map((m) => (
          <FilterChip
            key={m}
            active={modeFilter === m}
            onClick={() => setModeFilter(m)}
            label={m === 'all' ? 'All modes' : PAYMENT_MODE_META[m]?.label ?? m}
          />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            {filtered.length}
          </Badge>
        </div>
      </div>

      {/* ─────────── Bulk-approve toolbar ─────────── */}
      {isAdmin && bulkSelected.size > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-brand-500/40 bg-brand-50/60 px-4 py-2.5 dark:bg-brand-500/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-brand-700 dark:text-brand-300" />
            <span className="font-semibold text-ink-1">
              {bulkSelected.size} top-up{bulkSelected.size === 1 ? '' : 's'} selected
            </span>
            <span className="text-ink-3">·</span>
            <span className="font-mono text-xs text-ink-2 tabular-nums">
              {formatPaiseAsINR(
                rows
                  .filter((r) => bulkSelected.has(r.id))
                  .reduce((sum, r) => sum + r.amountPaise, 0),
                { compact: true },
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setBulkSelected(new Set())}>
              Clear
            </Button>
            <Button size="sm" onClick={() => setBulkConfirmOpen(true)}>
              <Check className="h-3.5 w-3.5" /> Approve all
            </Button>
          </div>
        </div>
      ) : null}

      {/* ─────────── Day-grouped table ─────────── */}
      {list.isLoading ? (
        <Card className="overflow-hidden p-0">
          <DataTable columns={columns} data={[]} loading density="compact" empty="Loading…" />
        </Card>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={
            statusFilter === 'PENDING'
              ? 'Nothing pending — inbox zero ✨'
              : 'No top-ups match these filters'
          }
          description={
            isAdmin
              ? 'Pending submissions will appear here for approval.'
              : 'Click "Request top-up" to submit your first one.'
          }
        />
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.day}>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {g.day}
                </p>
                <p className="font-mono text-[10px] text-ink-4">
                  {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'} ·{' '}
                  {formatPaiseAsINR(
                    g.rows.reduce((sum, r) => sum + r.amountPaise, 0),
                    { compact: true },
                  )}
                </p>
              </div>
              <Card className="overflow-hidden p-0">
                <DataTable
                  columns={columns}
                  data={g.rows}
                  loading={false}
                  density="compact"
                  empty=""
                  onRowClick={(r) => setDetailTarget(r)}
                />
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* ─────────── Dialogs ─────────── */}
      <TopupDialog open={requestOpen} onOpenChange={setRequestOpen} />

      <ConfirmDialog
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        title={`Approve top-up of ${approveTarget ? formatPaiseAsINR(approveTarget.amountPaise) : ''}?`}
        description="The wallet will be credited and an immutable ledger entry posted. This cannot be reversed except by an admin adjustment."
        confirmLabel="Approve & post"
        onConfirm={async () => {
          if (approveTarget) await approve.mutateAsync({ id: approveTarget.id });
        }}
      />

      <ConfirmDialog
        open={bulkConfirmOpen}
        onOpenChange={setBulkConfirmOpen}
        title={`Approve ${bulkSelected.size} top-ups?`}
        description={`Each wallet will be credited and an immutable ledger entry posted. Total credited: ${formatPaiseAsINR(
          rows
            .filter((r) => bulkSelected.has(r.id))
            .reduce((sum, r) => sum + r.amountPaise, 0),
        )}.`}
        confirmLabel="Approve all"
        onConfirm={bulkApproveAll}
      />

      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject top-up</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="rounded-md border bg-surface-2/40 p-3 text-xs">
              <p className="font-semibold text-ink-1">
                {rejectTarget?.agencyName ?? rejectTarget?.distributorName} ·{' '}
                <span className="font-mono text-ink-2">
                  {rejectTarget ? formatPaiseAsINR(rejectTarget.amountPaise) : ''}
                </span>
              </p>
              <p className="font-mono text-[10px] text-ink-4">
                Ref {rejectTarget?.referenceNumber ?? '—'}
              </p>
            </div>
            <p className="text-sm text-ink-3">
              The reason is shown to the requester in their history. Be precise — they'll use
              this to resubmit cleanly.
            </p>
            <Input
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. proof unclear, amount mismatch with bank statement"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectReason.trim().length < 3 || reject.isPending}
              onClick={async () => {
                if (rejectTarget) {
                  await reject.mutateAsync({
                    id: rejectTarget.id,
                    reason: rejectReason.trim(),
                  });
                  setRejectTarget(null);
                }
              }}
            >
              {reject.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TopupDetailDialog
        target={detailTarget}
        onOpenChange={(open) => !open && setDetailTarget(null)}
        isAdmin={isAdmin}
        onApprove={(r) => {
          setDetailTarget(null);
          setApproveTarget(r);
        }}
        onReject={(r) => {
          setDetailTarget(null);
          setRejectTarget(r);
        }}
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
  tone: 'warning' | 'success' | 'danger' | 'brand';
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
        highlight && 'border-warning/40 shadow-md',
      )}
    >
      {highlight ? (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-warning/20 blur-2xl"
        />
      ) : null}
      <CardContent className="relative p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-3">{label}</p>
          <span
            className={cn(
              'grid h-7 w-7 place-items-center rounded-md',
              tone === 'warning' && 'bg-warning-soft text-warning',
              tone === 'success' && 'bg-success-soft text-success',
              tone === 'danger' && 'bg-danger-soft text-danger',
              tone === 'brand' && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15',
            )}
          >
            {icon}
          </span>
        </div>
        <p className="mt-2 font-mono text-xl font-bold tabular-nums text-ink-1 sm:text-2xl">
          {loading ? <Skeleton className="h-7 w-16" /> : value}
        </p>
        {subValue ? <p className="mt-0.5 font-mono text-[10px] text-ink-4">{subValue}</p> : null}
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

function TopupDetailDialog({
  target,
  onOpenChange,
  isAdmin,
  onApprove,
  onReject,
}: {
  target: PublicTopupRequest | null;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onApprove: (r: PublicTopupRequest) => void;
  onReject: (r: PublicTopupRequest) => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Top-up details</DialogTitle>
        </DialogHeader>
        {target ? (
          <DialogBody className="space-y-4">
            {/* Status hero */}
            <div
              className={cn(
                'rounded-lg border p-4',
                target.status === 'PENDING' && 'border-warning/40 bg-warning-soft/40',
                target.status === 'APPROVED' && 'border-success/40 bg-success-soft/40',
                target.status === 'REJECTED' && 'border-danger/40 bg-danger-soft/40',
                target.status === 'EXPIRED' && 'border-strong bg-surface-2/60',
              )}
            >
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                Amount
              </p>
              <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-ink-1">
                {formatPaiseAsINR(target.amountPaise)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Badge
                  variant={
                    STATUS_META[target.status]?.tone === 'neutral'
                      ? 'neutral'
                      : STATUS_META[target.status]?.tone ?? 'neutral'
                  }
                >
                  {STATUS_META[target.status]?.label ?? target.status}
                </Badge>
                <span className="text-xs text-ink-3">·</span>
                <span className="font-mono text-[10px] text-ink-3">
                  {timeAgo(target.createdAt)}
                </span>
              </div>
            </div>

            {/* Key/value rows */}
            <div className="grid gap-2.5 text-sm">
              <DetailRow label="Account" value={target.agencyName ?? target.distributorName ?? '—'} />
              <DetailRow label="Code" value={target.agencyCode ?? target.distributorCode ?? '—'} mono />
              <DetailRow label="Mode" value={PAYMENT_MODE_META[target.paymentMode]?.label ?? target.paymentMode} />
              <DetailRow label="Reference" value={target.referenceNumber ?? '—'} mono />
              <DetailRow
                label="Created"
                value={new Date(target.createdAt).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              />
              {target.notes ? <DetailRow label="Notes" value={target.notes} /> : null}
              {target.rejectionReason ? (
                <DetailRow
                  label="Rejection reason"
                  value={target.rejectionReason}
                  tone="danger"
                />
              ) : null}
              {target.proofUrl ? (
                <DetailRow
                  label="Proof"
                  value={
                    <a
                      href={target.proofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300"
                    >
                      Open proof <ExternalLink className="h-3 w-3" />
                    </a>
                  }
                />
              ) : null}
            </div>

            {target.status === 'PENDING' && Date.now() - new Date(target.createdAt).getTime() > 60 * 60_000 ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft/40 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="text-ink-2">
                  <p className="font-semibold">Pending over 1 hour</p>
                  <p className="text-ink-3">
                    Agents tend to follow up when manual top-ups sit longer than 60 min — try to
                    decide now if the proof is clear.
                  </p>
                </div>
              </div>
            ) : null}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {isAdmin && target?.status === 'PENDING' ? (
            <>
              <Button variant="danger" onClick={() => target && onReject(target)}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => target && onApprove(target)}>
                <Check className="h-4 w-4" /> Approve
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dashed pb-2 last:border-b-0">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span
        className={cn(
          'text-right text-sm',
          mono && 'font-mono text-xs',
          tone === 'danger' ? 'text-danger' : 'text-ink-1',
        )}
      >
        {value}
      </span>
    </div>
  );
}
