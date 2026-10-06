'use client';

import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';

export interface DailyVisits {
  date: string;
  scheduled: number;
  completed: number;
  missed: number;
  cancelled: number;
  open: number;
}

/**
 * Categorical slots 1–4 of the reference palette, in fixed order (validated: CVD ΔE ≥ 9.1, normal ≥ 22.9 on white).
 * Aqua and yellow are under 3:1 against the surface, so the chart always has a legend and a table view.
 */
const SERIES = [
  { key: 'completed', label: 'Completed', color: '#0f766e' },
  { key: 'missed', label: 'Missed', color: '#ef5a46' },
  { key: 'cancelled', label: 'Cancelled', color: '#94a3b8' },
  { key: 'open', label: 'Not yet done', color: '#5fdcc8' },
] as const;
const INK = { secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', baseline: '#c3c2b7', surface: '#ffffff' };

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
};

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as DailyVisits;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-medium text-slate-900">{shortDate(String(label))}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-2 text-slate-700">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}: <span className="tabular-nums text-slate-900">{row[s.key]}</span>
        </p>
      ))}
    </div>
  );
}

/** Visits per day, stacked by outcome — with a legend, a hover tooltip and a table view. */
export function VisitsChart({ daily }: { daily: DailyVisits[] }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul aria-label="Legend" className="flex flex-wrap gap-4 text-xs text-slate-700">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
        <button type="button" className="text-xs text-brand-800 underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-sm" aria-label="Visits per day">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Date</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 pr-4 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {daily.map((d) => (
                <tr key={d.date}>
                  <td className="py-1.5 pr-4">{shortDate(d.date)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key} className="py-1.5 pr-4 text-right">
                      {d[s.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-64" role="img" aria-label="Visits per day by outcome (use 'Show as table' for the numbers)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} maxBarSize={24}>
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fill: INK.muted, fontSize: 11 }}
                axisLine={{ stroke: INK.baseline }}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis allowDecimals={false} tick={{ fill: INK.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} />} cursor={{ fill: 'rgba(11,11,11,0.04)' }} />
              {SERIES.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="visits"
                  fill={s.color}
                  // 2px surface-colored gap between stacked segments; only the top segment gets the rounded end.
                  stroke={INK.surface}
                  strokeWidth={2}
                  radius={i === SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
