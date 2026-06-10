'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BookText,
  Building2,
  Calendar,
  CalendarDays,
  Coins,
  FileSpreadsheet,
  GitCompare,
  PieChart,
  Receipt,
  Ticket,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell as ChartCell,
  Pie,
  PieChart as RePieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BOOKING_STATUS,
  TRANSACTIONAL_REPORTS,
  type ReportColumn,
  type ReportResponse,
  type ReportType,
} from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@/components/ui';
import { useApiQuery } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { ApiCallError } from '@/lib/api';
import { downloadAuthenticatedFile } from '@/lib/download';
import { formatPaiseAsINR } from '@/lib/money';
import { cn } from '@/lib/utils';

const REPORTS: {
  type: ReportType;
  label: string;
  description: string;
  icon: typeof TrendingUp;
}[] = [
  { type: 'BOOKING', label: 'Booking report', description: 'Every booking with fare breakdown', icon: Ticket },
  { type: 'CANCELLATION', label: 'Cancellation report', description: 'Cancelled & refunded bookings', icon: Ban },
  { type: 'COMMISSION', label: 'Commission earned', description: 'Platform commission per ticket', icon: Coins },
  { type: 'LEDGER', label: 'Agency ledger', description: 'Wallet debits & credits', icon: BookText },
  { type: 'SALES', label: 'Sales', description: 'GMV + earnings by day', icon: TrendingUp },
  { type: 'AGENCY_PERFORMANCE', label: 'Agency performance', description: 'Bookings, refund rate, avg ticket', icon: Building2 },
  { type: 'SUPPLIER_COMPARISON', label: 'Supplier comparison', description: 'Win rate, avg fare, GMV', icon: GitCompare },
  { type: 'ROUTE_PROFITABILITY', label: 'Route profitability', description: 'Margin % per sector', icon: PieChart },
  { type: 'REFUND_TRACKER', label: 'Refund tracker', description: 'Amendment cycle times', icon: AlertTriangle },
  { type: 'OUTSTANDING', label: 'Outstanding', description: 'Credit utilisation', icon: Receipt },
  { type: 'GST', label: 'GST', description: 'Tax collected by month', icon: Calendar },
];

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const QUICK_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

const STATUS_ALL = '__ALL__';

export default function ReportsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [active, setActive] = useState<ReportType>('BOOKING');
  const [from, setFrom] = useState(todayPlus(-30));
  const [to, setTo] = useState(todayPlus(0));
  const [agencyName, setAgencyName] = useState('');
  const [bookingStatus, setBookingStatus] = useState<string>(STATUS_ALL);
  const [downloading, setDownloading] = useState(false);

  const reportQuery = {
    type: active,
    from,
    to,
    agencyName: agencyName.trim() || undefined,
    bookingStatus: bookingStatus === STATUS_ALL ? undefined : bookingStatus,
  };
  const report = useApiQuery<ReportResponse>(
    ['report', active, from, to, agencyName.trim(), bookingStatus],
    '/api/v1/reports',
    { query: reportQuery },
  );

  const isTransactional = TRANSACTIONAL_REPORTS.includes(active);

  const setRange = (days: number) => {
    setFrom(todayPlus(-days));
    setTo(todayPlus(0));
  };

  const downloadXlsx = async () => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ type: active, from, to });
      if (agencyName.trim()) params.set('agencyName', agencyName.trim());
      if (bookingStatus !== STATUS_ALL) params.set('bookingStatus', bookingStatus);
      await downloadAuthenticatedFile(
        `/api/v1/reports/export?${params.toString()}`,
        `${active.toLowerCase()}-${from}-to-${to}.xlsx`,
        accessToken,
      );
    } catch (err) {
      toast.error(err instanceof ApiCallError ? err.message : 'Export failed');
    } finally {
      setDownloading(false);
    }
  };

  const activeMeta = REPORTS.find((r) => r.type === active)!;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights · Reports"
        title="Reports"
        description="Seven pre-built lenses on sales, performance, refunds, and GST. Export to Excel for finance hand-off."
        actions={
          <Button onClick={downloadXlsx} loading={downloading} disabled={!report.data}>
            <FileSpreadsheet className="h-4 w-4" />
            {!downloading ? 'Export Excel' : 'Generating…'}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Report selector */}
        <aside className="space-y-1.5">
          <p className="eyebrow mb-2 px-1 text-ink-3">Choose a report</p>
          {REPORTS.map((r) => {
            const isActive = active === r.type;
            return (
              <button
                type="button"
                key={r.type}
                onClick={() => setActive(r.type)}
                className={cn(
                  'group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all duration-fast',
                  isActive
                    ? 'border-brand-300 bg-brand-50 dark:bg-brand-500/15 dark:border-brand-500/40'
                    : 'border-strong bg-surface-1 hover:border-ink-5 hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'grid h-8 w-8 shrink-0 place-items-center rounded-md transition-colors',
                    isActive
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300'
                      : 'bg-surface-2 text-ink-3 group-hover:bg-brand-50 group-hover:text-brand-700',
                  )}
                >
                  <r.icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm font-semibold',
                      isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-1',
                    )}
                  >
                    {r.label}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">{r.description}</p>
                </div>
              </button>
            );
          })}
        </aside>

        <div className="space-y-5">
          {/* Date range card */}
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
              <div className="flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-ink-3" strokeWidth={1.75} />
                <span className="text-xs font-semibold text-ink-2">Range</span>
              </div>
              {QUICK_RANGES.map((r) => {
                const isActive =
                  from === todayPlus(-r.days) && to === todayPlus(0);
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
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Agency name / code"
                  value={agencyName}
                  onChange={(e) => setAgencyName(e.target.value)}
                  className="h-8 w-44"
                  fullWidth={false}
                />
                <Select value={bookingStatus} onValueChange={setBookingStatus}>
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STATUS_ALL}>All statuses</SelectItem>
                    {BOOKING_STATUS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

          {report.isLoading ? (
            <>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-72 w-full" />
              <Skeleton className="h-96 w-full" />
            </>
          ) : report.data ? (
            <>
              {isTransactional ? (
                <p className="text-xs text-ink-3">
                  {report.data.rows.length} row{report.data.rows.length === 1 ? '' : 's'} ·{' '}
                  {report.data.from} → {report.data.to}
                </p>
              ) : (
                <>
                  <ReportKpiStrip report={report.data} type={active} />
                  <ReportHeroChart report={report.data} type={active} label={activeMeta.label} />
                </>
              )}
              <ReportTable report={report.data} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ────────── KPI strip — 3 derived stats per report ──────────

function ReportKpiStrip({ report, type }: { report: ReportResponse; type: ReportType }) {
  const kpis = useMemo(() => deriveKpis(report, type), [report, type]);

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {kpis.map((k) => (
        <Card key={k.label} tone={k.tone === 'brand' ? 'brand' : 'default'}>
          <CardContent className="p-4">
            <p
              className={cn(
                'eyebrow flex items-center gap-1.5',
                k.tone === 'brand' ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3',
              )}
            >
              {k.label}
            </p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-ink-1">{k.value}</p>
            {k.hint ? <p className="mt-0.5 text-xs text-ink-3">{k.hint}</p> : null}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

interface Kpi {
  label: string;
  value: string;
  hint?: string;
  tone?: 'brand' | 'default';
}

function deriveKpis(report: ReportResponse, type: ReportType): Kpi[] {
  const rows = report.rows;
  const totals = report.totals ?? {};

  const sumNum = (key: string) =>
    rows.reduce((s, r) => s + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);

  switch (type) {
    case 'SALES': {
      const gmv = (totals.gmv as number) ?? sumNum('gmv');
      const bookings = (totals.bookings as number) ?? sumNum('bookings');
      const days = Math.max(1, rows.length);
      return [
        { label: 'Total GMV', value: formatPaiseAsINR(gmv, { compact: true }), hint: `${days}-day window`, tone: 'brand' },
        { label: 'Bookings', value: bookings.toLocaleString('en-IN'), hint: `Avg ${(bookings / days).toFixed(1)}/day` },
        { label: 'Platform earnings', value: formatPaiseAsINR((totals.platformEarnings as number) ?? sumNum('platformEarnings'), { compact: true }) },
      ];
    }
    case 'AGENCY_PERFORMANCE': {
      const totalGmv = (totals.gmv as number) ?? sumNum('gmv');
      const totalBookings = (totals.bookings as number) ?? sumNum('bookings');
      const top = [...rows].sort((a, b) => ((b.gmv as number) ?? 0) - ((a.gmv as number) ?? 0))[0];
      return [
        { label: 'Total GMV', value: formatPaiseAsINR(totalGmv, { compact: true }), tone: 'brand' },
        { label: 'Agencies', value: rows.length.toString(), hint: `${totalBookings} bookings` },
        { label: 'Top agency', value: (top?.companyName as string) ?? '—', hint: top ? formatPaiseAsINR(top.gmv as number, { compact: true }) : undefined },
      ];
    }
    case 'SUPPLIER_COMPARISON': {
      return [
        { label: 'Suppliers', value: rows.length.toString(), tone: 'brand' },
        { label: 'Total bookings', value: (sumNum('bookings')).toLocaleString('en-IN') },
        { label: 'Total GMV', value: formatPaiseAsINR(sumNum('gmv'), { compact: true }) },
      ];
    }
    case 'ROUTE_PROFITABILITY': {
      const top = [...rows].sort((a, b) => ((b.margin as number) ?? 0) - ((a.margin as number) ?? 0))[0];
      return [
        { label: 'Total margin', value: formatPaiseAsINR(sumNum('margin'), { compact: true }), tone: 'brand' },
        { label: 'Routes', value: rows.length.toString(), hint: `${sumNum('bookings')} bookings` },
        { label: 'Top route', value: (top?.sector as string) ?? '—', hint: top ? formatPaiseAsINR(top.margin as number, { compact: true }) + ' margin' : undefined },
      ];
    }
    case 'REFUND_TRACKER': {
      return [
        { label: 'Refund requests', value: sumNum('count').toLocaleString('en-IN'), tone: 'brand' },
        { label: 'Total refunded', value: formatPaiseAsINR(sumNum('refundedPaise'), { compact: true }) },
        { label: 'Avg cycle (days)', value: rows.length ? (sumNum('avgDays') / rows.length).toFixed(1) : '—' },
      ];
    }
    case 'OUTSTANDING': {
      const limitTotal = sumNum('creditLimit');
      const outstandingTotal = sumNum('outstanding');
      const utilPct = limitTotal > 0 ? (outstandingTotal / limitTotal) * 100 : 0;
      return [
        { label: 'Total outstanding', value: formatPaiseAsINR(outstandingTotal, { compact: true }), tone: 'brand' },
        { label: 'Utilisation', value: `${utilPct.toFixed(1)}%`, hint: 'Across all agencies' },
        { label: 'Agencies on credit', value: rows.length.toString() },
      ];
    }
    case 'GST': {
      return [
        { label: 'GST collected', value: formatPaiseAsINR(sumNum('gstPaise'), { compact: true }), tone: 'brand' },
        { label: 'Periods', value: rows.length.toString() },
        { label: 'Avg / period', value: rows.length ? formatPaiseAsINR(sumNum('gstPaise') / rows.length, { compact: true }) : '—' },
      ];
    }
    default:
      return [];
  }
}

// ────────── Hero chart — picks viz by report type ──────────

const PRIMARY = 'var(--brand-500)';
const ACCENT = 'var(--accent-500)';
const tooltipStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border-1)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-md)',
  fontSize: 12,
  padding: '8px 10px',
} as const;

function ReportHeroChart({
  report,
  type,
  label,
}: {
  report: ReportResponse;
  type: ReportType;
  label: string;
}) {
  if (report.rows.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={TrendingUp}
            title="No data in this window"
            description="Try a wider date range, or run the report again after some bookings come through."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{label}</CardTitle>
            <CardDescription>
              {report.rows.length} {report.rows.length === 1 ? 'row' : 'rows'} · {report.from} → {report.to}
            </CardDescription>
          </div>
          <Badge variant="brand" dot>
            <TrendingUp className="h-3 w-3" /> Live
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">
          <ChartFor type={type} rows={report.rows} />
        </div>
      </CardContent>
    </Card>
  );
}

function ChartFor({ type, rows }: { type: ReportType; rows: ReportResponse['rows'] }) {
  switch (type) {
    case 'SALES':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-1)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="date" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })} width={60} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), 'GMV']} />
            <Bar dataKey="gmv" fill={PRIMARY} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'AGENCY_PERFORMANCE': {
      const top10 = [...rows].sort((a, b) => ((b.gmv as number) ?? 0) - ((a.gmv as number) ?? 0)).slice(0, 10);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top10} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-1)" strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })} />
            <YAxis type="category" dataKey="companyName" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={140} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), 'GMV']} />
            <Bar dataKey="gmv" fill={PRIMARY} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'SUPPLIER_COMPARISON': {
      const palette = ['var(--brand-500)', 'var(--accent-500)', 'var(--brand-700)', 'var(--success)', 'var(--warning)'];
      const data = rows.map((r) => ({ name: (r.supplier as string) ?? 'Unknown', value: (r.gmv as number) ?? 0 }));
      return (
        <ResponsiveContainer width="100%" height="100%">
          <RePieChart>
            <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), 'GMV']} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
              {data.map((_, i) => (
                <ChartCell key={i} fill={palette[i % palette.length]} />
              ))}
            </Pie>
          </RePieChart>
        </ResponsiveContainer>
      );
    }

    case 'ROUTE_PROFITABILITY': {
      const top10 = [...rows].sort((a, b) => ((b.margin as number) ?? 0) - ((a.margin as number) ?? 0)).slice(0, 10);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={top10} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-1)" strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })} />
            <YAxis type="category" dataKey="sector" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={120} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), 'Margin']} />
            <Bar dataKey="margin" fill={PRIMARY} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    case 'REFUND_TRACKER':
    case 'GST':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-1)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey={type === 'GST' ? 'period' : 'date'} stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} />
            <YAxis stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })} width={60} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), type === 'GST' ? 'GST' : 'Refunded']} />
            <Bar dataKey={type === 'GST' ? 'gstPaise' : 'refundedPaise'} fill={ACCENT} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );

    case 'OUTSTANDING':
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-1)" strokeDasharray="2 4" horizontal={false} />
            <XAxis type="number" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }} tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })} />
            <YAxis type="category" dataKey="companyName" stroke="var(--ink-3)" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={140} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={tooltipStyle} formatter={(v: number) => [formatPaiseAsINR(v), 'Outstanding']} />
            <Bar dataKey="outstanding" fill="var(--warning)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );

    default:
      return null;
  }
}

// ────────── Table ──────────

function ReportTable({ report }: { report: ReportResponse }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-surface-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
            <tr>
              {report.columns.map((c) => (
                <th key={c.key} className="px-4 py-3 text-left">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td className="px-4 py-12 text-center text-sm text-ink-3" colSpan={report.columns.length}>
                  No data in this window.
                </td>
              </tr>
            ) : (
              report.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b transition-colors last:border-b-0 hover:bg-surface-2/40"
                >
                  {report.columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      <Cell value={row[c.key] ?? null} column={c} />
                    </td>
                  ))}
                </tr>
              ))
            )}
            {report.totals ? (
              <tr className="border-t-2 bg-brand-50/40 dark:bg-brand-500/10">
                {report.columns.map((c, i) => (
                  <td key={c.key} className="px-4 py-3 font-bold">
                    {report.totals![c.key] != null ? (
                      <Cell value={report.totals![c.key]!} column={c} />
                    ) : i === 0 ? (
                      <span className="text-ink-1">TOTAL</span>
                    ) : (
                      ''
                    )}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Cell({ value, column }: { value: string | number | null; column: ReportColumn }) {
  if (value == null) return <span className="text-ink-3">—</span>;
  if (column.format === 'paise' && typeof value === 'number') {
    return <span className="font-mono tabular-nums">{formatPaiseAsINR(value, { compact: true })}</span>;
  }
  if (column.format === 'percent' && typeof value === 'number') {
    return <span className="font-mono tabular-nums">{value.toFixed(2)}%</span>;
  }
  if (column.format === 'number' && typeof value === 'number') {
    return <span className="font-mono tabular-nums">{value.toLocaleString('en-IN')}</span>;
  }
  if (column.format === 'date' && typeof value === 'string') {
    return <span className="font-mono text-xs">{value}</span>;
  }
  return <span>{String(value)}</span>;
}
