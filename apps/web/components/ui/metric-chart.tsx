'use client';
// Referenced by progress-metric-card.tsx but not supplied in the pasted spec — built here to match
// its expected API exactly. Colours resolve through our own --th-* tokens (already bridged to
// shadcn's bg-card/border-border/text-foreground names in globals.css), not hardcoded hex.
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type SeriesPoint = { value: number; date: string };
export type MetricAccent = 'emerald' | 'rose' | 'neutral' | 'blue' | 'amber';
export type MetricSeries = { name: string; data: SeriesPoint[]; accent?: MetricAccent };
export type ChartSeries = { name: string; data: SeriesPoint[]; color: string };
export type ChartView = 'curve' | 'bars';

export const ACCENTS: Record<MetricAccent, { stroke: string; text: string }> = {
  emerald: { stroke: 'var(--th-allow)', text: 'var(--th-allow)' },
  rose: { stroke: 'var(--th-deny)', text: 'var(--th-deny)' },
  neutral: { stroke: 'var(--th-ink)', text: 'var(--th-muted)' },
  blue: { stroke: 'var(--th-accent-ink)', text: 'var(--th-accent-ink)' },
  amber: { stroke: 'var(--th-escalate)', text: 'var(--th-escalate)' },
};

export const SERIES_COLORS = [
  'var(--th-accent-ink)',
  'var(--th-allow)',
  'var(--th-escalate)',
  'var(--th-deny)',
];

export function formatCompact(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function MetricChart({
  series,
  view,
  defaultIndex,
  valueFormatter,
  dateFormatter,
}: {
  series: ChartSeries[];
  view: ChartView;
  defaultIndex?: number;
  valueFormatter: (v: number) => string;
  dateFormatter: (d: string) => string;
}) {
  const primary = series[0];
  if (!primary || primary.data.length < 2) return null;

  const tooltipStyle = {
    background: 'var(--th-surface)',
    border: '1px solid var(--th-line)',
    borderRadius: 8,
    fontSize: 12,
  };
  const formatTooltip = (value: unknown, _name: unknown, item: { payload?: { date?: string } }) => [
    valueFormatter(Number(value)),
    item.payload?.date ? dateFormatter(item.payload.date) : '',
  ];

  if (view === 'bars') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={primary.data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip contentStyle={tooltipStyle} formatter={formatTooltip} />
          <Bar dataKey="value" fill={primary.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart
        data={primary.data}
        margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
        // eslint-disable-next-line react/no-unknown-property
        key={defaultIndex}
      >
        <defs>
          <linearGradient id="metric-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary.color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={primary.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip contentStyle={tooltipStyle} formatter={formatTooltip} />
        <Area
          type="monotone"
          dataKey="value"
          stroke={primary.color}
          strokeWidth={2}
          fill="url(#metric-chart-fill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
