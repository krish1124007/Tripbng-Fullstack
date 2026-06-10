'use client';

// Admin → Reports → DI Payouts
//
// Period-windowed view over INCENTIVE_CREDIT + TDS_DEDUCT ledger entries.
// Drives the Form 26Q feed: gross / TDS / net per distributor-incentive
// agency. SUPER_ADMIN only.

import { useMemo, useState } from 'react';
import {
  CalendarDays,
  FileDown,
  FileSpreadsheet,
  Gift,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui';
import { ApiCallError } from '@/lib/api';
import { useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { downloadAuthenticatedFile } from '@/lib/download';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

interface DiPayoutAgencyRow {
  agencyId: string;
  agencyCode: string;
  companyName: string;
  incentiveCount: number;
  grossIncentivePaise: number;
  tdsPaise: number;
  netCreditPaise: number;
}

interface DiPayoutReport {
  generatedAt: string;
  from: string;
  to: string;
  totalAgencies: number;
  totalGrossIncentivePaise: number;
  totalTdsPaise: number;
  totalNetCreditPaise: number;
  rows: DiPayoutAgencyRow[];
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// The API takes ISO datetimes — convert YYYY-MM-DD by anchoring to UTC
// midnight so the period boundaries are predictable.
function toIsoStart(d: string): string {
  return new Date(`${d}T00:00:00.000Z`).toISOString();
}
function toIsoEnd(d: string): string {
  return new Date(`${d}T23:59:59.999Z`).toISOString();
}

const QUICK_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'FY', days: 365 },
] as const;

export default function DiPayoutsPage() {
  const me = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [from, setFrom] = useState(todayPlus(-30));
  const [to, setTo] = useState(todayPlus(0));
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);

  const fromIso = useMemo(() => toIsoStart(from), [from]);
  const toIso = useMemo(() => toIsoEnd(to), [to]);

  const query = useApiQuery<DiPayoutReport>(
    ['admin', 'di-payouts', fromIso, toIso],
    '/api/v1/admin/reports/di-payouts',
    {
      query: { from: fromIso, to: toIso },
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  const download = async (format: 'xlsx' | 'pdf') => {
    setDownloading(format);
    try {
      const qs = new URLSearchParams({ format, from: fromIso, to: toIso });
      await downloadAuthenticatedFile(
        `/api/v1/admin/reports/di-payouts?${qs.toString()}`,
        `di-payouts-${from}-to-${to}.${format}`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Export failed');
    } finally {
      setDownloading(null);
    }
  };

  const setRange = (days: number) => {
    setFrom(todayPlus(-days));
    setTo(todayPlus(0));
  };

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="DI payout reports are restricted to platform super-admins (they feed the Form 26Q TDS return)."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Reports"
        title="DI payouts"
        description="Distributor-incentive payouts in the selected window — gross, TDS withheld, and net credited to wallets. Feeds the quarterly Form 26Q TDS return."
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => download('pdf')}
              loading={downloading === 'pdf'}
              disabled={!query.data}
            >
              <FileDown className="h-4 w-4" />
              PDF
            </Button>
            <Button
              onClick={() => download('xlsx')}
              loading={downloading === 'xlsx'}
              disabled={!query.data}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Excel
            </Button>
          </div>
        }
      />

      {/* Range picker */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
            <span className="text-xs font-semibold text-ink-2">Period</span>
          </div>
          {QUICK_RANGES.map((r) => {
            const isActive = from === todayPlus(-r.days) && to === todayPlus(0);
            return (
              <button
                key={r.label}
                type="button"
                onClick={() => setRange(r.days)}
                className={cn(
                  'inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                  isActive
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
                )}
              >
                Last {r.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-auto"
              fullWidth={false}
            />
            <span className="text-ink-3">→</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-auto"
              fullWidth={false}
            />
          </div>
        </CardContent>
      </Card>

      {/* KPI strip */}
      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : query.data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Agencies paid" value={query.data.totalAgencies.toLocaleString('en-IN')} />
          <Kpi
            label="Gross incentive"
            value={formatPaiseAsINR(query.data.totalGrossIncentivePaise, { compact: true })}
            tone="brand"
          />
          <Kpi
            label="TDS withheld"
            value={formatPaiseAsINR(query.data.totalTdsPaise, { compact: true })}
          />
          <Kpi
            label="Net credited"
            value={formatPaiseAsINR(query.data.totalNetCreditPaise, { compact: true })}
          />
        </div>
      ) : null}

      {/* Table */}
      {query.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !query.data || query.data.rows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Gift}
              title="No DI activity in this period"
              description="Try a wider window — the DI ledger entries are only written when bookings on the DI module clear."
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-surface-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-3 text-left">Agency</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">TDS</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-right">Effective TDS%</th>
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((r) => {
                  const tdsPct =
                    r.grossIncentivePaise > 0
                      ? (r.tdsPaise / r.grossIncentivePaise) * 100
                      : 0;
                  return (
                    <tr
                      key={r.agencyId}
                      className="border-b transition-colors last:border-b-0 hover:bg-surface-2/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-1">{r.companyName}</div>
                        <div className="font-mono text-xs text-ink-3">{r.agencyCode}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {r.incentiveCount.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                        {formatPaiseAsINR(r.grossIncentivePaise, { compact: true })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-warning">
                        {formatPaiseAsINR(r.tdsPaise, { compact: true })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatPaiseAsINR(r.netCreditPaise, { compact: true })}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-3">
                        {tdsPct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t-2 bg-brand-50/40 dark:bg-brand-500/10">
                  <td className="px-4 py-3 font-bold text-ink-1">TOTAL</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold">
                    {query.data.rows
                      .reduce((s, r) => s + r.incentiveCount, 0)
                      .toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold">
                    {formatPaiseAsINR(query.data.totalGrossIncentivePaise, { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-warning">
                    {formatPaiseAsINR(query.data.totalTdsPaise, { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold">
                    {formatPaiseAsINR(query.data.totalNetCreditPaise, { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {query.data.totalGrossIncentivePaise > 0
                      ? `${((query.data.totalTdsPaise / query.data.totalGrossIncentivePaise) * 100).toFixed(2)}%`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'brand';
}) {
  return (
    <Card tone={tone === 'brand' ? 'brand' : 'default'}>
      <CardContent className="p-4">
        <p
          className={cn(
            'eyebrow',
            tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3',
          )}
        >
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold tabular-nums text-ink-1">{value}</p>
      </CardContent>
    </Card>
  );
}
