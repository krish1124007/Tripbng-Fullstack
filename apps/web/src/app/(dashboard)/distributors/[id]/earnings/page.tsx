'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { EarningsResponse, EarningsRow } from '@tripbng/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
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
import { formatPaiseAsINR } from '@/lib/money';
import { TopNBarChart } from '@/components/charts';

function dateMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

<<<<<<< HEAD
export default function DistributorEarningsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
=======
// Next.js 14: `params` is a plain object, not a Promise. Using
// React.use(params) here was a Next-15-only idiom that crashed at
// runtime with "An unsupported type was passed to use()".
export default function DistributorEarningsPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
>>>>>>> 566bd27eb66c25e48cac612ba93cd29c96d1ddb7

  const [from, setFrom] = useState(dateMinusDays(30));
  const [to, setTo] = useState(todayStr());
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'agency'>('day');

  const earnings = useApiQuery<EarningsResponse>(
    ['distributor', id, 'earnings', { from, to, groupBy }],
    `/api/v1/distributors/${id}/earnings`,
    {
      query: { from, to, groupBy },
    },
  );

  const columns = useMemo<ColumnDef<EarningsRow, unknown>[]>(
    () => [
      {
        header: groupBy === 'agency' ? 'Agency' : 'Period',
        accessorKey: 'label',
        cell: ({ getValue }) => <span className="text-sm text-ink-2">{getValue() as string}</span>,
      },
      {
        header: 'Bookings',
        accessorKey: 'bookingCount',
        cell: ({ getValue }) => (
          <Badge variant="outline" className="font-mono">{getValue() as number}</Badge>
        ),
      },
      {
        header: 'Cancelled',
        accessorKey: 'cancelledCount',
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return v > 0 ? <Badge variant="warning" className="font-mono">{v}</Badge> : <span className="text-xs text-ink-3">—</span>;
        },
      },
      {
        header: 'Gross GMV',
        accessorKey: 'grossGmvPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm tabular-nums">
            {formatPaiseAsINR(getValue() as number, { compact: true })}
          </span>
        ),
      },
      {
        header: 'Earnings',
        accessorKey: 'earningsPaise',
        cell: ({ getValue }) => (
          <span className="font-mono text-sm font-medium tabular-nums text-ink-1">
            {formatPaiseAsINR(getValue() as number, { compact: true })}
          </span>
        ),
      },
    ],
    [groupBy],
  );

  const downloadCsv = () => {
    if (!earnings.data) return;
    const header = ['key', 'label', 'bookingCount', 'cancelledCount', 'grossGmvPaise', 'earningsPaise'];
    const rows = earnings.data.rows.map((r) => [
      r.key,
      r.label,
      r.bookingCount,
      r.cancelledCount,
      r.grossGmvPaise,
      r.earningsPaise,
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earnings-${groupBy}-${from}-to-${to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Earnings report"
        description="Distributor override commission, broken down however you slice it."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="h-4 w-4" /> Cockpit
              </Link>
            </Button>
            <Button variant="secondary" onClick={downloadCsv} disabled={!earnings.data}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-ink-3">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-ink-3">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-ink-3">Group by</label>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="agency">Agency</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardDescription>Total earnings</CardDescription>
            <CardTitle className="stat-number">
              {earnings.data
                ? formatPaiseAsINR(earnings.data.totals.earningsPaise, { compact: true })
                : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bookings</CardDescription>
            <CardTitle className="stat-number">{earnings.data?.totals.bookingCount ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Cancelled</CardDescription>
            <CardTitle className="stat-number">{earnings.data?.totals.cancelledCount ?? '—'}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      {groupBy === 'agency' && earnings.data && earnings.data.rows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Top agencies</CardTitle>
            <CardDescription>Sorted by earnings.</CardDescription>
          </CardHeader>
          <CardContent>
            <TopNBarChart
              valueLabel="Earnings"
              data={earnings.data.rows
                .slice(0, 8)
                .map((r) => ({ label: r.label.slice(0, 28), value: r.earningsPaise }))}
            />
          </CardContent>
        </Card>
      ) : null}

      {earnings.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <DataTable
          columns={columns}
          data={earnings.data?.rows ?? []}
          empty="No earnings in this window."
          density="compact"
        />
      )}
    </div>
  );
}
