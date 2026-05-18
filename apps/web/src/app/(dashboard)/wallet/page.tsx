'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownLeft,
  ArrowDownToLine,
  ArrowUpRight,
  CreditCard,
  Download,
  Plane,
  Plus,
  Send,
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
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
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

const FRIENDLY: Record<string, { label: string; icon: typeof Plane }> = {
  TOPUP: { label: 'Top-up', icon: ArrowDownToLine },
  BOOKING_DEBIT: { label: 'Booking', icon: Plane },
  REFUND_CREDIT: { label: 'Refund', icon: ArrowDownLeft },
  TRANSFER_IN: { label: 'Transfer in', icon: ArrowDownLeft },
  TRANSFER_OUT: { label: 'Transfer out', icon: ArrowUpRight },
  ADJUSTMENT_CREDIT: { label: 'Adjustment +', icon: ArrowDownLeft },
  ADJUSTMENT_DEBIT: { label: 'Adjustment −', icon: ArrowUpRight },
};

export default function WalletPage() {
  const me = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [topupOpen, setTopupOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const summary = useApiQuery<WalletSummary>(['wallet', 'me'], '/api/v1/wallet/me');

  const txns = useApiPaginatedQuery<PublicWalletTxn>(
    ['wallet-transactions', { page, typeFilter }],
    '/api/v1/wallet/transactions',
    {
      query: { page, limit: 20, type: typeFilter === 'all' ? undefined : typeFilter },
    },
  );

  const columns = useMemo<ColumnDef<PublicWalletTxn, unknown>[]>(
    () => [
      {
        header: 'Type',
        accessorKey: 'type',
        cell: ({ getValue, row }) => {
          const v = getValue() as string;
          const meta = FRIENDLY[v] ?? { label: v, icon: Plane };
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
              {new Date(row.original.createdAt as unknown as string).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
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
            {row.original.direction === 'CREDIT' ? '+' : '−'} {formatPaiseAsINR(row.original.amountPaise)}
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
    setDownloading(true);
    try {
      const today = new Date();
      const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
      const from = monthAgo.toISOString().slice(0, 10);
      const to = today.toISOString().slice(0, 10);
      await downloadAuthenticatedFile(
        `/api/v1/wallet/statement?from=${from}&to=${to}`,
        `tripbng-statement-${from}-to-${to}.pdf`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const sum = summary.data;
  const utilisation = sum && sum.creditLimitPaise > 0 ? sum.outstandingPaise / sum.creditLimitPaise : 0;
  const utilisationPct = utilisation * 100;
  const utilisationTone = utilisation > 0.8 ? 'danger' : utilisation > 0.5 ? 'warning' : 'success';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operate · Wallet"
        title="Your wallet"
        description="Live balance, every paisa traceable through the immutable ledger."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={downloadStatement} loading={downloading}>
              <Download className="h-4 w-4" /> {!downloading ? 'Statement' : 'Generating…'}
            </Button>
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

      {/* ─────────── Hero balance card + credit utilisation ─────────── */}
      <section className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <Card
          tone="brand"
          elevation="raised"
          className="relative overflow-hidden"
        >
          {/* Decorative blob */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-200/30 blur-3xl dark:bg-brand-500/10"
          />
          <CardContent className="relative p-6 lg:p-8">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-brand-700 dark:text-brand-300">
                  <WalletIcon className="h-3 w-3" />
                  Available balance
                </p>
                <p className="mt-3 text-[42px] font-bold tabular-nums leading-none tracking-tight text-ink-1 lg:text-[56px]">
                  {sum ? formatPaiseAsINR(sum.walletBalancePaise) : '—'}
                </p>
                {sum ? (
                  <p className="mt-3 font-mono text-xs text-ink-3">
                    {sum.ownerCode} · {sum.ownerName}
                  </p>
                ) : null}
              </div>
              <Button onClick={() => setTopupOpen(true)} size="lg" className="shrink-0">
                <Plus className="h-4 w-4" /> Top up
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6 lg:p-7">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow flex items-center gap-1.5 text-ink-3">
                  <CreditCard className="h-3 w-3" />
                  Credit
                </p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-ink-1">
                  {sum ? formatPaiseAsINR(sum.creditLimitPaise, { compact: true }) : '—'}
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  Outstanding{' '}
                  <span className="font-mono font-semibold tabular-nums text-ink-2">
                    {sum ? formatPaiseAsINR(sum.outstandingPaise, { compact: true }) : '—'}
                  </span>
                </p>
              </div>
              <span
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-md',
                  utilisationTone === 'danger' && 'bg-danger-soft text-danger',
                  utilisationTone === 'warning' && 'bg-warning-soft text-warning',
                  utilisationTone === 'success' && 'bg-success-soft text-success',
                )}
              >
                <CreditCard className="h-4 w-4" />
              </span>
            </div>
            {sum && sum.creditLimitPaise > 0 ? (
              <div className="mt-5">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-ink-3">
                  <span>Utilised</span>
                  <span>{Math.round(utilisationPct)}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-slow',
                      utilisationTone === 'danger' && 'bg-danger',
                      utilisationTone === 'warning' && 'bg-warning',
                      utilisationTone === 'success' && 'bg-success',
                    )}
                    style={{ width: `${Math.min(100, utilisationPct)}%` }}
                  />
                </div>
                <p className="mt-2 text-[10px] text-ink-3">
                  Available headroom{' '}
                  <span className="font-mono font-semibold text-ink-2">
                    {formatPaiseAsINR(sum.creditLimitPaise - sum.outstandingPaise, { compact: true })}
                  </span>
                </p>
              </div>
            ) : (
              <p className="mt-4 text-xs text-ink-3">No credit line configured.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ─────────── Filter chips + sort ─────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-1 p-2">
        <Badge variant="brand" dot>
          <TrendingUp className="h-3 w-3" /> Statement
        </Badge>
        <div className="mx-1 h-5 w-px bg-border" />
        <FilterChip
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
          label="All"
        />
        <FilterChip
          active={typeFilter === 'TOPUP'}
          onClick={() => setTypeFilter('TOPUP')}
          label="Top-ups"
        />
        <FilterChip
          active={typeFilter === 'BOOKING_DEBIT'}
          onClick={() => setTypeFilter('BOOKING_DEBIT')}
          label="Bookings"
        />
        <FilterChip
          active={typeFilter === 'REFUND_CREDIT'}
          onClick={() => setTypeFilter('REFUND_CREDIT')}
          label="Refunds"
        />
        <div className="ml-auto">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
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

      {/* ─────────── Transactions table ─────────── */}
      <Card className="overflow-hidden p-0">
        <DataTable
          columns={columns}
          data={txns.data?.data ?? []}
          loading={txns.isLoading}
          density="default"
          empty="No transactions yet."
        />
      </Card>

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
