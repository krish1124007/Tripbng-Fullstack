'use client';

// Wallet page — agency / distributor financial cockpit.
//
// Story:
//   1. Balance hero — four canonical rows (My Wallet, Available Credit,
//      Credit Limit, Outstanding Due) with utilisation bar.
//   2. This-month KPI strip — credits in, debits out, net flow, booking
//      debits count. All derived client-side from the txn window.
//   3. Two charts side-by-side — 30-day balance trend (area) + spend
//      mix donut by transaction type for the current month.
//   4. Filter bar — type chips, search by ref/desc, custom date range,
//      CSV + PDF exports.
//   5. Transactions table — grouped by day, with day headers.

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowDownUp,
  ArrowUpRight,
  CreditCard,
  Download,
  FileSpreadsheet,
  Plane,
  Plus,
  Search,
  Send,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet as WalletIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PublicWalletTxn, WalletSummary } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  DataTable,
  Input,
  PageHeader,
  Pagination,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { CategoryDonut, EarningsTrendChart, type DonutSlice } from '@/components/charts';
import { useApiPaginatedQuery, useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ApiCallError } from '@/lib/api';
import { downloadAuthenticatedFile } from '@/lib/download';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';
import { TopupDialog } from './_topup-dialog';
import { TransferDialog } from './_transfer-dialog';

const TXN_TYPES = [
  'TOPUP',
  'BOOKING_DEBIT',
  'REFUND_CREDIT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'ADJUSTMENT_CREDIT',
  'ADJUSTMENT_DEBIT',
] as const;

type TypeFilter = 'all' | (typeof TXN_TYPES)[number];

const FRIENDLY: Record<string, { label: string; icon: typeof Plane; color: string }> = {
  TOPUP: { label: 'Top-up', icon: ArrowDownToLine, color: 'var(--success)' },
  BOOKING_DEBIT: { label: 'Booking', icon: Plane, color: 'var(--brand-500)' },
  REFUND_CREDIT: { label: 'Refund', icon: ArrowDownLeft, color: 'var(--accent-500)' },
  TRANSFER_IN: { label: 'Transfer in', icon: ArrowDownLeft, color: 'var(--success)' },
  TRANSFER_OUT: { label: 'Transfer out', icon: ArrowUpRight, color: 'var(--warning)' },
  ADJUSTMENT_CREDIT: { label: 'Adjustment +', icon: ArrowDownLeft, color: 'var(--ink-4)' },
  ADJUSTMENT_DEBIT: { label: 'Adjustment −', icon: ArrowUpRight, color: 'var(--danger)' },
};

/** ISO yyyy-MM-dd for "N days ago from today, local time". */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Group transactions by their date (yyyy-MM-dd local). Returns the
 * groups in the same order as the source list — used for the
 * day-grouped transaction view.
 */
function groupByDay(rows: PublicWalletTxn[]): Array<{ day: string; rows: PublicWalletTxn[] }> {
  const groups: Array<{ day: string; rows: PublicWalletTxn[] }> = [];
  let current: { day: string; rows: PublicWalletTxn[] } | null = null;
  for (const r of rows) {
    const d = new Date(r.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (!current || current.day !== d) {
      current = { day: d, rows: [] };
      groups.push(current);
    }
    current.rows.push(r);
  }
  return groups;
}

/** Human-readable day label — Today / Yesterday / dd Mon. */
function friendlyDay(iso: string): string {
  const today = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  if (iso === today) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return iso;
}

export default function WalletPage() {
  const me = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [topupOpen, setTopupOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  // Statement-export date range — defaults to last 30 days. Lives in
  // local state so the export popover and the chart window stay in sync.
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoToday());
  const [downloading, setDownloading] = useState<'pdf' | 'csv' | null>(null);

  const summary = useApiQuery<WalletSummary>(['wallet', 'me'], '/api/v1/wallet/me');

  // Paginated table — respects the type filter only. Search filters
  // the loaded page client-side so users get instant feedback without
  // a round-trip; the API filter is a future enhancement.
  const txns = useApiPaginatedQuery<PublicWalletTxn>(
    ['wallet-transactions', { page, typeFilter }],
    '/api/v1/wallet/transactions',
    {
      query: { page, limit: 20, type: typeFilter === 'all' ? undefined : typeFilter },
    },
  );

  // Wider window query — backs the 30-day balance trend + spend-mix
  // donut + this-month KPI strip. Cached separately so changing the
  // table filter doesn't invalidate the charts.
  const recent = useApiPaginatedQuery<PublicWalletTxn>(
    ['wallet-transactions', 'recent', { from, to }],
    '/api/v1/wallet/transactions',
    {
      query: { page: 1, limit: 200, from, to },
    },
  );
  const recentRows = recent.data?.data ?? [];

  // ── Derived: 30-day balance trend ──
  // We sample the running balanceAfterPaise at the LAST transaction of
  // each day. Days without activity are forward-filled from the most
  // recent prior value so the chart line stays continuous.
  const balanceTrend = useMemo(() => {
    if (recentRows.length === 0) return [] as { day: string; earningsPaise: number }[];
    // Sort oldest→newest so the running balance walks forward.
    const sorted = [...recentRows].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const byDay = new Map<string, number>();
    for (const r of sorted) {
      const d = new Date(r.createdAt).toISOString().slice(0, 10);
      byDay.set(d, r.balanceAfterPaise);
    }
    // Walk every day in the window and forward-fill gaps.
    const out: { day: string; earningsPaise: number }[] = [];
    const start = new Date(from);
    const end = new Date(to);
    let last = sorted[0]!.balanceAfterPaise;
    for (
      let cur = new Date(start);
      cur <= end;
      cur.setDate(cur.getDate() + 1)
    ) {
      const iso = cur.toISOString().slice(0, 10);
      if (byDay.has(iso)) last = byDay.get(iso)!;
      out.push({ day: iso, earningsPaise: last });
    }
    return out;
  }, [recentRows, from, to]);

  // ── Derived: this-month KPI strip ──
  const monthlyKpis = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let creditsPaise = 0;
    let debitsPaise = 0;
    let bookingCount = 0;
    for (const r of recentRows) {
      const t = new Date(r.createdAt).getTime();
      if (t < monthStart) continue;
      if (r.direction === 'CREDIT') creditsPaise += r.amountPaise;
      else debitsPaise += r.amountPaise;
      if (r.type === 'BOOKING_DEBIT') bookingCount += 1;
    }
    return {
      creditsPaise,
      debitsPaise,
      netPaise: creditsPaise - debitsPaise,
      bookingCount,
    };
  }, [recentRows]);

  // ── Derived: spend mix donut ──
  // Sum DEBIT side per type for the current month. Credits show on the
  // sparkline and KPI strip, so this stays focused on "where did the
  // money go". Skipped when there's no debit activity.
  const spendMix = useMemo<DonutSlice[]>(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const totals = new Map<string, number>();
    for (const r of recentRows) {
      if (r.direction !== 'DEBIT') continue;
      if (new Date(r.createdAt).getTime() < monthStart) continue;
      totals.set(r.type, (totals.get(r.type) ?? 0) + r.amountPaise);
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({
        label: FRIENDLY[type]?.label ?? type,
        value,
        color: FRIENDLY[type]?.color ?? 'var(--ink-4)',
      }));
  }, [recentRows]);

  // ── Filter loaded page by search input (client-side) ──
  const visibleRows = useMemo(() => {
    const rows = txns.data?.data ?? [];
    if (!search.trim()) return rows;
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.txnId.toLowerCase().includes(needle) ||
        (r.description ?? '').toLowerCase().includes(needle),
    );
  }, [txns.data, search]);
  const grouped = useMemo(() => groupByDay(visibleRows), [visibleRows]);

  const columns = useMemo<ColumnDef<PublicWalletTxn, unknown>[]>(
    () => [
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ getValue, row }) => {
          const v = getValue() as string;
          const meta = FRIENDLY[v] ?? { label: v, icon: Plane, color: 'var(--ink-4)' };
          const credit = row.original.direction === 'CREDIT';
          const Icon = meta.icon;
          return (
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-md',
                  credit
                    ? 'bg-success-soft text-success dark:bg-success/15'
                    : 'bg-danger-soft text-danger dark:bg-danger/15',
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-1">{meta.label}</p>
                <p className="font-mono text-[10px] text-ink-3">{row.original.txnId}</p>
              </div>
            </div>
          );
        },
      },
      {
        header: 'Description',
        accessorKey: 'description',
        cell: ({ getValue, row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm text-ink-2">{(getValue() as string) ?? '—'}</p>
            <p className="font-mono text-[10px] text-ink-3 tabular-nums">
              {new Date(row.original.createdAt as unknown as string).toLocaleTimeString(
                'en-IN',
                { hour: '2-digit', minute: '2-digit' },
              )}
            </p>
          </div>
        ),
      },
      {
        header: 'Amount',
        accessorKey: 'amountPaise',
        cell: ({ row }) => (
          <span
            className={cn(
              'font-mono text-sm font-semibold tabular-nums',
              row.original.direction === 'CREDIT' ? 'text-success' : 'text-danger',
            )}
          >
            {row.original.direction === 'CREDIT' ? '+' : '−'}{' '}
            {formatPaiseAsINR(row.original.amountPaise)}
          </span>
        ),
      },
      {
        header: 'Balance after',
        accessorKey: 'balanceAfterPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums text-ink-1">
            {formatPaiseAsINR(getValue() as number)}
          </span>
        ),
      },
    ],
    [],
  );

  const downloadStatement = async () => {
    setDownloading('pdf');
    try {
      await downloadAuthenticatedFile(
        `/api/v1/wallet/statement?from=${from}&to=${to}`,
        `tripbng-statement-${from}-to-${to}.pdf`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  // CSV export — uses the already-loaded `recent` window data so the
  // file matches exactly what the user sees in the charts above.
  const downloadCsv = () => {
    setDownloading('csv');
    try {
      const rows = recentRows;
      const header = [
        'txnId',
        'date',
        'time',
        'type',
        'direction',
        'amount_inr',
        'balance_after_inr',
        'description',
      ];
      const escape = (v: string) =>
        /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      const lines = rows.map((r) => {
        const d = new Date(r.createdAt);
        return [
          r.txnId,
          d.toISOString().slice(0, 10),
          d.toISOString().slice(11, 16),
          r.type,
          r.direction,
          (r.amountPaise / 100).toFixed(2),
          (r.balanceAfterPaise / 100).toFixed(2),
          r.description ?? '',
        ]
          .map((c) => escape(String(c)))
          .join(',');
      });
      const csv = [header.join(','), ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tripbng-statement-${from}-to-${to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('CSV export failed');
    } finally {
      setDownloading(null);
    }
  };

  const sum = summary.data;
  const balancePaise = sum?.walletBalancePaise ?? 0;
  const limitPaise = sum?.creditLimitPaise ?? 0;
  const outstandingPaise = sum?.outstandingPaise ?? 0;
  const availableCreditPaise = Math.max(0, limitPaise - outstandingPaise);
  const utilisation = limitPaise > 0 ? Math.min(100, (outstandingPaise / limitPaise) * 100) : 0;
  const utilisationTone =
    utilisation >= 80 ? 'danger' : utilisation >= 50 ? 'warning' : 'success';
  const spendPower = balancePaise + availableCreditPaise;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate · Wallet"
        title="Your wallet"
        description="Live balance, every paisa traceable through the immutable ledger."
        actions={
          <div className="flex items-center gap-2">
            <StatementPopover
              from={from}
              to={to}
              onFromChange={setFrom}
              onToChange={setTo}
              onDownloadPdf={downloadStatement}
              onDownloadCsv={downloadCsv}
              downloading={downloading}
            />
            {me?.role === 'DISTRIBUTOR' ? (
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                <Send className="h-4 w-4" /> Transfer
              </Button>
            ) : null}
            <Button onClick={() => setTopupOpen(true)}>
              <Plus className="h-4 w-4" /> Top up
            </Button>
          </div>
        }
      />

      {/* ─────────── Balance hero — 4 canonical rows ─────────── */}
      <section className="grid gap-4 lg:grid-cols-4">
        <BalanceCard
          tone="brand"
          icon={<WalletIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          eyebrow="My Wallet"
          value={formatPaiseAsINR(balancePaise)}
          hint={sum ? `${sum.ownerCode} · ${sum.ownerName}` : '—'}
          large
        />
        <BalanceCard
          tone="success"
          icon={<CreditCard className="h-3.5 w-3.5" strokeWidth={2} />}
          eyebrow="Available Credit"
          value={formatPaiseAsINR(availableCreditPaise)}
          hint={
            limitPaise > 0
              ? `${Math.round(utilisation)}% utilised`
              : 'No credit line configured'
          }
          progress={limitPaise > 0 ? utilisation : null}
          progressTone={utilisationTone}
        />
        <BalanceCard
          tone="neutral"
          icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />}
          eyebrow="Credit Limit"
          value={formatPaiseAsINR(limitPaise)}
          hint="Approved by accounts"
        />
        <BalanceCard
          tone={outstandingPaise > 0 ? 'danger' : 'neutral'}
          icon={<ArrowDownUp className="h-3.5 w-3.5" strokeWidth={2} />}
          eyebrow="Outstanding (Due)"
          value={
            outstandingPaise > 0
              ? `- ${formatPaiseAsINR(outstandingPaise)}`
              : formatPaiseAsINR(0)
          }
          hint={
            outstandingPaise > 0 ? 'Current invoice exposure' : 'No dues — fully settled'
          }
          valueDanger={outstandingPaise > 0}
        />
      </section>

      {/* ─────────── This-month KPI strip ─────────── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          tone="success"
          label="Credits this month"
          value={formatPaiseAsINR(monthlyKpis.creditsPaise, { compact: true })}
          loading={recent.isLoading}
        />
        <KpiTile
          icon={<TrendingDown className="h-3.5 w-3.5" />}
          tone="danger"
          label="Debits this month"
          value={formatPaiseAsINR(monthlyKpis.debitsPaise, { compact: true })}
          loading={recent.isLoading}
        />
        <KpiTile
          icon={
            monthlyKpis.netPaise >= 0 ? (
              <ArrowDownLeft className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5" />
            )
          }
          tone={monthlyKpis.netPaise >= 0 ? 'brand' : 'warning'}
          label="Net flow"
          value={`${monthlyKpis.netPaise >= 0 ? '+' : '−'} ${formatPaiseAsINR(Math.abs(monthlyKpis.netPaise), { compact: true })}`}
          loading={recent.isLoading}
        />
        <KpiTile
          icon={<Plane className="h-3.5 w-3.5" />}
          tone="brand"
          label="Bookings (debits)"
          value={String(monthlyKpis.bookingCount)}
          subValue="this month"
          loading={recent.isLoading}
        />
      </section>

      {/* ─────────── Charts row ─────────── */}
      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow text-ink-3">Balance trend</p>
                <p className="mt-1 text-sm font-semibold text-ink-1">
                  Last {Math.max(0, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000))} days
                </p>
              </div>
              <Badge variant="outline" className="font-mono text-[10px]">
                Spend power {formatPaiseAsINR(spendPower, { compact: true })}
              </Badge>
            </div>
            {recent.isLoading ? (
              <div className="h-[220px] animate-pulse rounded-md bg-surface-2" />
            ) : balanceTrend.length > 0 ? (
              <EarningsTrendChart data={balanceTrend} />
            ) : (
              <div className="grid h-[220px] place-items-center rounded-md border border-dashed text-xs text-ink-3">
                Not enough activity in this window
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="mb-3">
              <p className="eyebrow text-ink-3">Spend mix</p>
              <p className="mt-1 text-sm font-semibold text-ink-1">
                Where the money goes
              </p>
            </div>
            {recent.isLoading ? (
              <div className="h-[200px] animate-pulse rounded-md bg-surface-2" />
            ) : spendMix.length > 0 ? (
              <>
                <CategoryDonut
                  data={spendMix}
                  height={200}
                  innerSublabel="This month"
                  innerLabel={formatPaiseAsINR(monthlyKpis.debitsPaise, { compact: true })}
                />
                <ul className="mt-3 space-y-1.5">
                  {spendMix.map((s) => {
                    const pct = monthlyKpis.debitsPaise
                      ? (s.value / monthlyKpis.debitsPaise) * 100
                      : 0;
                    return (
                      <li
                        key={s.label}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span
                            className="inline-block h-2 w-2 rounded-sm"
                            style={{ background: s.color }}
                          />
                          <span className="truncate text-ink-2">{s.label}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3 font-mono text-ink-1 tabular-nums">
                          <span className="text-ink-3">{Math.round(pct)}%</span>
                          {formatPaiseAsINR(s.value, { compact: true })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <div className="grid h-[200px] place-items-center rounded-md border border-dashed text-xs text-ink-3">
                No spend this month yet
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ─────────── Filter bar ─────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Input
          placeholder="Search by ref or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leading={<Search className="h-4 w-4" strokeWidth={1.75} />}
          className="h-8 w-full max-w-xs"
          fullWidth={false}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <FilterChip
          active={typeFilter === 'all'}
          onClick={() => {
            setTypeFilter('all');
            setPage(1);
          }}
          label="All"
        />
        <FilterChip
          active={typeFilter === 'TOPUP'}
          onClick={() => {
            setTypeFilter('TOPUP');
            setPage(1);
          }}
          label="Top-ups"
        />
        <FilterChip
          active={typeFilter === 'BOOKING_DEBIT'}
          onClick={() => {
            setTypeFilter('BOOKING_DEBIT');
            setPage(1);
          }}
          label="Bookings"
        />
        <FilterChip
          active={typeFilter === 'REFUND_CREDIT'}
          onClick={() => {
            setTypeFilter('REFUND_CREDIT');
            setPage(1);
          }}
          label="Refunds"
        />
        <div className="ml-auto">
          <Select
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v as TypeFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-8 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All transaction types</SelectItem>
              {TXN_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FRIENDLY[t]?.label ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─────────── Transactions table (day-grouped) ─────────── */}
      {txns.isLoading ? (
        <Card className="overflow-hidden p-0">
          <DataTable
            columns={columns}
            data={[]}
            loading
            density="default"
            empty="Loading…"
          />
        </Card>
      ) : grouped.length === 0 ? (
        <Card>
          <CardContent className="grid place-items-center py-12 text-sm text-ink-3">
            {search ? `No transactions match "${search}".` : 'No transactions yet.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <div key={g.day}>
              <div className="mb-1.5 flex items-center justify-between px-1">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  {friendlyDay(g.day)}
                </p>
                <p className="font-mono text-[10px] text-ink-4">
                  {g.rows.length} {g.rows.length === 1 ? 'entry' : 'entries'}
                </p>
              </div>
              <Card className="overflow-hidden p-0">
                <DataTable
                  columns={columns}
                  data={g.rows}
                  loading={false}
                  density="default"
                  empty=""
                />
              </Card>
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={txns.data?.meta.totalPages ?? 1}
        total={txns.data?.meta.total ?? 0}
        onPageChange={setPage}
      />

      <TopupDialog open={topupOpen} onOpenChange={setTopupOpen} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} />
    </div>
  );
}

// ───────── Sub-components ─────────

function BalanceCard({
  tone,
  icon,
  eyebrow,
  value,
  hint,
  progress,
  progressTone,
  large,
  valueDanger,
}: {
  tone: 'brand' | 'success' | 'neutral' | 'danger';
  icon: React.ReactNode;
  eyebrow: string;
  value: string;
  hint: string;
  progress?: number | null;
  progressTone?: 'success' | 'warning' | 'danger';
  large?: boolean;
  valueDanger?: boolean;
}) {
  return (
    <Card
      className={cn('relative overflow-hidden', large && 'lg:col-span-1')}
      tone={tone === 'brand' ? 'brand' : undefined}
    >
      {tone === 'brand' && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-brand-200/30 blur-2xl dark:bg-brand-500/10"
        />
      )}
      <CardContent className="relative p-5">
        <div className="flex items-center justify-between">
          <p
            className={cn(
              'eyebrow flex items-center gap-1.5',
              tone === 'brand' && 'text-brand-700 dark:text-brand-300',
              tone === 'success' && 'text-success',
              tone === 'danger' && 'text-danger',
              tone === 'neutral' && 'text-ink-3',
            )}
          >
            <span
              className={cn(
                'grid h-5 w-5 place-items-center rounded',
                tone === 'brand' && 'bg-brand-100 text-brand-700 dark:bg-brand-500/20',
                tone === 'success' && 'bg-success-soft text-success',
                tone === 'neutral' && 'bg-surface-2 text-ink-3',
                tone === 'danger' && 'bg-danger-soft text-danger',
              )}
            >
              {icon}
            </span>
            {eyebrow}
          </p>
        </div>
        <p
          className={cn(
            'mt-3 font-mono font-bold tabular-nums leading-none tracking-tight',
            large ? 'text-3xl' : 'text-2xl',
            valueDanger ? 'text-danger' : 'text-ink-1',
          )}
        >
          {value}
        </p>
        <p className="mt-1.5 text-[11px] text-ink-3">{hint}</p>
        {progress != null ? (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-slow',
                progressTone === 'danger' && 'bg-danger',
                progressTone === 'warning' && 'bg-warning',
                progressTone === 'success' && 'bg-success',
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function KpiTile({
  icon,
  tone,
  label,
  value,
  subValue,
  loading,
}: {
  icon: React.ReactNode;
  tone: 'success' | 'danger' | 'warning' | 'brand';
  label: string;
  value: string;
  subValue?: string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-ink-3">{label}</p>
          <span
            className={cn(
              'grid h-6 w-6 place-items-center rounded-md',
              tone === 'success' && 'bg-success-soft text-success',
              tone === 'danger' && 'bg-danger-soft text-danger',
              tone === 'warning' && 'bg-warning-soft text-warning',
              tone === 'brand' && 'bg-brand-50 text-brand-700 dark:bg-brand-500/15',
            )}
          >
            {icon}
          </span>
        </div>
        <p className="mt-2 font-mono text-xl font-bold tabular-nums text-ink-1">
          {loading ? '—' : value}
        </p>
        {subValue ? (
          <p className="mt-0.5 text-[10px] text-ink-4">{subValue}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Statement download popover — pick from / to dates, then PDF or CSV.
 * The dates ALSO drive the charts above, so changing them in here
 * updates the balance trend + spend mix in real time.
 */
function StatementPopover({
  from,
  to,
  onFromChange,
  onToChange,
  onDownloadPdf,
  onDownloadCsv,
  downloading,
}: {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onDownloadPdf: () => void;
  onDownloadCsv: () => void;
  downloading: 'pdf' | 'csv' | null;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">
          <Download className="h-4 w-4" /> Statement
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold text-ink-1">Download statement</p>
          <p className="text-[11px] text-ink-3">
            Charts above update to match this window.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">
              From
            </label>
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => onFromChange(e.target.value)}
              className="h-8"
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">
              To
            </label>
            <Input
              type="date"
              value={to}
              min={from}
              max={isoToday()}
              onChange={(e) => onToChange(e.target.value)}
              className="h-8"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={onDownloadCsv}
            loading={downloading === 'csv'}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={onDownloadPdf} loading={downloading === 'pdf'}>
            <Download className="h-3.5 w-3.5" /> PDF
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
