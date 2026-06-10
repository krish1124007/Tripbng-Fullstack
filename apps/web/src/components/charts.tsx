'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPaiseAsINR } from '@/lib/money';

// Common chart palette pulled off the design tokens so dark mode works without prop wiring.
// Brand-blue is the primary; accent (orange) is reserved for comparison series and highlights.
const PRIMARY = 'var(--brand-500)';
const ACCENT = 'var(--accent-500)';
const INK_3 = 'var(--ink-3)';
const BORDER = 'var(--border-1)';

const tooltipStyle = {
  background: 'var(--surface-1)',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  boxShadow: 'var(--shadow-md)',
  fontSize: 12,
  padding: '8px 10px',
} as const;

interface SeriesPoint {
  label: string;
  value: number;
}

// ───────── Sparkline ─────────
// Tiny inline trend line for KPI cards. No axes, no tooltip — just the shape.
export function Sparkline({
  data,
  color = PRIMARY,
  height = 40,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const series = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ───────── Earnings trend (cockpit hero) ─────────
export function EarningsTrendChart({ data }: { data: { day: string; earningsPaise: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="earnings-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.32} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={BORDER} strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="day"
          stroke={INK_3}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }}
          tickFormatter={(d: string) => d.slice(5)}
        />
        <YAxis
          stroke={INK_3}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }}
          tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })}
          width={60}
        />
        <Tooltip
          cursor={{ stroke: PRIMARY, strokeWidth: 1, strokeDasharray: '3 3' }}
          contentStyle={tooltipStyle}
          formatter={(v: number) => [formatPaiseAsINR(v), 'Earnings']}
          labelFormatter={(d: string) => d}
        />
        <Area
          type="monotone"
          dataKey="earningsPaise"
          stroke={PRIMARY}
          strokeWidth={2.5}
          fill="url(#earnings-gradient)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ───────── Bookings trend (compact line) ─────────
export function BookingsTrendChart({ data }: { data: { day: string; bookingCount: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={BORDER} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="day" hide />
        <YAxis hide />
        <Tooltip
          cursor={{ stroke: PRIMARY }}
          contentStyle={tooltipStyle}
          formatter={(v: number) => [v, 'Bookings']}
          labelFormatter={(d: string) => d}
        />
        <Line
          type="monotone"
          dataKey="bookingCount"
          stroke={ACCENT}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ───────── Top-N horizontal bars ─────────
export function TopNBarChart({ data, valueLabel }: { data: SeriesPoint[]; valueLabel: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 16, left: 12, bottom: 0 }}>
        <CartesianGrid stroke={BORDER} strokeDasharray="2 4" horizontal={false} />
        <XAxis
          type="number"
          stroke={INK_3}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fontFamily: 'var(--font-jetbrains)' }}
          tickFormatter={(v: number) => formatPaiseAsINR(v, { compact: true })}
        />
        <YAxis
          type="category"
          dataKey="label"
          stroke={INK_3}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          width={160}
        />
        <Tooltip
          cursor={{ fill: 'var(--surface-2)' }}
          contentStyle={tooltipStyle}
          formatter={(v: number) => [formatPaiseAsINR(v), valueLabel]}
        />
        <Bar dataKey="value" fill={PRIMARY} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ───────── Donut (spend mix etc) ─────────
// Slim ring chart for category breakdowns. Each slice carries its own
// colour from the slice data — the wallet page uses brand/accent/
// success/warning/danger tokens to keep slice colours on-theme.
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function CategoryDonut({
  data,
  height = 200,
  formatValue,
  innerLabel,
  innerSublabel,
}: {
  data: DonutSlice[];
  height?: number;
  formatValue?: (v: number) => string;
  innerLabel?: string;
  innerSublabel?: string;
}) {
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            stroke="var(--surface-1)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number, name: string) => [
              formatValue ? formatValue(v) : formatPaiseAsINR(v),
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
      {innerLabel ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-3">
            {innerSublabel}
          </p>
          <p className="font-mono text-base font-bold tabular-nums text-ink-1">{innerLabel}</p>
        </div>
      ) : null}
    </div>
  );
}
