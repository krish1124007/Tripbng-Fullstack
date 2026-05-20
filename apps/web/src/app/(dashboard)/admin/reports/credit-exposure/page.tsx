'use client';

// Admin → Reports → Credit exposure
//
// Surface for the Phase-10 aging report + Phase-11 XLSX/PDF exporters.
// SUPER_ADMIN only. The same URL backs the JSON table, the XLSX download,
// and the PDF download — picked by `?format=`. Default JSON drives the
// table; the export buttons hit the same URL with the format query.

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  FileDown,
  FileSpreadsheet,
  Filter,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
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

type AgingBucket = 'current' | '0-7' | '8-15' | '16-30' | '30+';

interface CreditExposureRow {
  agencyId: string;
  agencyCode: string;
  companyName: string;
  creditLimitPaise: number;
  creditUsedPaise: number;
  creditAvailablePaise: number;
  utilisationPercent: number;
  creditDueDate: string | null;
  daysToDue: number | null;
  agingBucket: AgingBucket;
  bookingBlocked: boolean;
  blockReason: string | null;
}

interface CreditExposureReport {
  generatedAt: string;
  totalAgencies: number;
  totalOutstandingPaise: number;
  totalLimitPaise: number;
  byBucket: Record<AgingBucket, { count: number; outstandingPaise: number }>;
  rows: CreditExposureRow[];
}

// Mirror the colour scale from the XLSX bucket fills + PDF tint so the
// three views read as one report — finance shouldn't have to translate.
const BUCKET_COLORS: Record<AgingBucket, { bg: string; text: string; label: string }> = {
  current: { bg: 'bg-success/15', text: 'text-success', label: 'Current' },
  '0-7': { bg: 'bg-warning/15', text: 'text-warning', label: '0–7d overdue' },
  '8-15': { bg: 'bg-warning/25', text: 'text-warning', label: '8–15d overdue' },
  '16-30': { bg: 'bg-danger/15', text: 'text-danger', label: '16–30d overdue' },
  '30+': { bg: 'bg-danger/25', text: 'text-danger', label: '30+d overdue' },
};

const BUCKET_ORDER: AgingBucket[] = ['current', '0-7', '8-15', '16-30', '30+'];

export default function CreditExposurePage() {
  const me = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [minOutstandingRupees, setMinOutstandingRupees] = useState('');
  const [bucketFilter, setBucketFilter] = useState<AgingBucket | 'all'>('all');
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);

  const minOutstandingPaise = useMemo(() => {
    if (!minOutstandingRupees) return undefined;
    const n = Number(minOutstandingRupees);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n * 100);
  }, [minOutstandingRupees]);

  const query = useApiQuery<CreditExposureReport>(
    ['admin', 'credit-exposure', minOutstandingPaise ?? 0],
    '/api/v1/admin/reports/credit-exposure',
    {
      query: minOutstandingPaise ? { minOutstandingPaise } : undefined,
      enabled: me?.role === 'SUPER_ADMIN',
    },
  );

  // Client-side bucket filter. The server filter is by min-outstanding only —
  // bucket filtering is purely a presentation choice, so we don't round-trip.
  const visibleRows = useMemo(() => {
    if (!query.data) return [];
    if (bucketFilter === 'all') return query.data.rows;
    return query.data.rows.filter((r) => r.agingBucket === bucketFilter);
  }, [query.data, bucketFilter]);

  const download = async (format: 'xlsx' | 'pdf') => {
    setDownloading(format);
    try {
      const qs = new URLSearchParams({ format });
      if (minOutstandingPaise) qs.set('minOutstandingPaise', String(minOutstandingPaise));
      await downloadAuthenticatedFile(
        `/api/v1/admin/reports/credit-exposure?${qs.toString()}`,
        `credit-exposure-${new Date().toISOString().slice(0, 10)}.${format}`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Export failed');
    } finally {
      setDownloading(null);
    }
  };

  if (me?.role !== 'SUPER_ADMIN') {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Shield}
            title="Super-admin only"
            description="Credit exposure reports are restricted to platform super-admins."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin · Reports"
        title="Credit exposure"
        description="Outstanding credit per agency, aged. Drives the daily follow-up workflow and feeds the credit-due reminder cron."
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

      {/* KPI strip */}
      {query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : query.data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi label="Agencies on credit" value={query.data.totalAgencies.toLocaleString('en-IN')} />
          <Kpi
            label="Total outstanding"
            value={formatPaiseAsINR(query.data.totalOutstandingPaise, { compact: true })}
            tone="brand"
          />
          <Kpi
            label="Total limit"
            value={formatPaiseAsINR(query.data.totalLimitPaise, { compact: true })}
          />
          <Kpi
            label="Utilisation"
            value={
              query.data.totalLimitPaise > 0
                ? `${((query.data.totalOutstandingPaise / query.data.totalLimitPaise) * 100).toFixed(1)}%`
                : '—'
            }
          />
        </div>
      ) : null}

      {/* Bucket chips */}
      {query.data ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex items-center gap-1.5 pr-2">
              <Filter className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
              <span className="text-xs font-semibold text-ink-2">Aging</span>
            </div>
            <BucketChip
              label="All"
              count={query.data.totalAgencies}
              outstanding={query.data.totalOutstandingPaise}
              active={bucketFilter === 'all'}
              onClick={() => setBucketFilter('all')}
            />
            {BUCKET_ORDER.map((b) => {
              const slot = query.data!.byBucket[b];
              return (
                <BucketChip
                  key={b}
                  label={BUCKET_COLORS[b].label}
                  count={slot.count}
                  outstanding={slot.outstandingPaise}
                  active={bucketFilter === b}
                  onClick={() => setBucketFilter(b)}
                  tone={b}
                />
              );
            })}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-3">Min outstanding</span>
              <Input
                type="number"
                placeholder="₹"
                value={minOutstandingRupees}
                onChange={(e) => setMinOutstandingRupees(e.target.value)}
                className="h-8 w-28"
                fullWidth={false}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Table */}
      {query.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : !query.data || visibleRows.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={AlertTriangle}
              title={
                query.data && query.data.totalAgencies > 0
                  ? 'No agencies in this filter'
                  : 'No outstanding credit'
              }
              description={
                query.data && query.data.totalAgencies > 0
                  ? 'Try a different bucket or lower the minimum-outstanding threshold.'
                  : 'Either all credit accounts are clean or no agency is on the CREDIT module.'
              }
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
                  <th className="px-4 py-3 text-right">Limit</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-right">Util %</th>
                  <th className="px-4 py-3 text-left">Due date</th>
                  <th className="px-4 py-3 text-right">Days</th>
                  <th className="px-4 py-3 text-left">Bucket</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr
                    key={r.agencyId}
                    className={cn(
                      'border-b transition-colors last:border-b-0 hover:bg-surface-2/40',
                      r.agingBucket !== 'current' && 'bg-warning/5',
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink-1">{r.companyName}</div>
                      <div className="font-mono text-xs text-ink-3">{r.agencyCode}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatPaiseAsINR(r.creditLimitPaise, { compact: true })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                      {formatPaiseAsINR(r.creditUsedPaise, { compact: true })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.utilisationPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-2">
                      {r.creditDueDate ? r.creditDueDate.slice(0, 10) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {r.daysToDue === null ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <span className={r.daysToDue < 0 ? 'text-danger' : 'text-ink-2'}>
                          {r.daysToDue}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                          BUCKET_COLORS[r.agingBucket].bg,
                          BUCKET_COLORS[r.agingBucket].text,
                        )}
                      >
                        {BUCKET_COLORS[r.agingBucket].label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {r.bookingBlocked ? (
                        <Badge variant="danger" dot>
                          Blocked
                        </Badge>
                      ) : (
                        <span className="text-xs text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
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

function BucketChip({
  label,
  count,
  outstanding,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  outstanding: number;
  active: boolean;
  onClick: () => void;
  tone?: AgingBucket;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
          : 'border-strong text-ink-2 hover:border-ink-5 hover:bg-surface-2',
      )}
    >
      {tone ? (
        <span className={cn('h-1.5 w-1.5 rounded-full', BUCKET_COLORS[tone].bg.replace('/15', '').replace('/25', ''))} />
      ) : null}
      {label}
      <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-ink-3">
        {count}
      </span>
      <span className="text-[10px] text-ink-3 font-mono tabular-nums">
        {formatPaiseAsINR(outstanding, { compact: true })}
      </span>
    </button>
  );
}
