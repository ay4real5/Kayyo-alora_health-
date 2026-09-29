'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { VisitsChart, type DailyVisits } from '@/components/reports/visits-chart';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import { useAgencyToday } from '@/lib/use-agency-today';

interface Census {
  active: number;
  admissions: number;
  discharges: number;
  activeByPayer: { payer: string; patients: number }[];
}
interface Utilization {
  totals: { scheduled: number; completed: number; missed: number; cancelled: number; open: number; completionRate: number | null };
  daily: DailyVisits[];
}
interface Evv {
  completedVisits: number;
  verified: number;
  awaitingReview: number;
  missing: number;
  verifiedRate: number | null;
}
interface Productivity {
  rows: { staffId: string; name: string; discipline: string; completedVisits: number; missedVisits: number; hours: number; averageVisitMinutes: number | null }[];
}
interface Missed {
  rows: { visitId: string; date: string; patient: string; caregiver: string | null; visitType: string; status: string; reason: string | null }[];
}
interface Financial {
  billed: number;
  collected: number;
  outstanding: number;
  denied: { claims: number; amount: number; rate: number | null; byReason: { reason: string; claims: number; amount: number }[] };
}

const PRESETS = [7, 30, 90] as const;
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Reports dashboard (D-065): the numbers that matter, visits over time, and exportable lists. */
export default function ReportsPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const [preset, setPreset] = useState<number | 'custom'>(30);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const range =
    preset === 'custom' && custom.from && custom.to
      ? custom
      : { from: new Date(Date.parse(`${today}T00:00:00Z`) - ((preset === 'custom' ? 30 : preset) - 1) * 86_400_000).toISOString().slice(0, 10), to: today };
  const qs = `from=${range.from}&to=${range.to}`;
  const allowed = can('reports:read');
  const census = useReport<Census>('census', qs, allowed);
  const utilization = useReport<Utilization>('visit-utilization', qs, allowed);
  const evv = useReport<Evv>('evv-compliance', qs, allowed);
  const productivity = useReport<Productivity>('staff-productivity', qs, allowed);
  const missed = useReport<Missed>('missed-visits', qs, allowed);
  const financial = useReport<Financial>('financial-summary', qs, allowed && can('billing:read'));
  const refresh = useMutation({
    mutationFn: () => request('/reports/refresh', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reports'] }),
  });
  const download = useMutation({
    mutationFn: async (name: string) => {
      const file = (await request<{ fileName: string; content: string }>(`/reports/${name}?${qs}&format=csv`)).data;
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: file.fileName }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  if (!allowed) return <PageHeader title="Reports" subtitle="You don't have access to reports." />;
  const error = census.error ?? utilization.error ?? evv.error ?? productivity.error ?? missed.error ?? financial.error ?? download.error;
  const maxPayer = Math.max(1, ...(census.data?.activeByPayer.map((p) => p.patients) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        subtitle={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={
          <Button variant="secondary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            Refresh numbers
          </Button>
        }
      />
      {/* Filters: one row above the charts. */}
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Date range">
        {PRESETS.map((days) => (
          <Button key={days} variant={preset === days ? 'primary' : 'secondary'} onClick={() => setPreset(days)}>
            Last {days} days
          </Button>
        ))}
        <Button variant={preset === 'custom' ? 'primary' : 'secondary'} onClick={() => setPreset('custom')}>
          Custom
        </Button>
        {preset === 'custom' && (
          <>
            <Field label="From" type="date" value={custom.from} max={today} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <Field label="To" type="date" value={custom.to} max={today} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </>
        )}
      </div>
      <ErrorAlert error={error} />

      <section aria-label="Key numbers" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Active patients" value={census.data?.active} sub={census.data && `${census.data.admissions} admitted · ${census.data.discharges} discharged`} />
        <Tile
          label="Visits completed"
          value={utilization.data?.totals.completionRate == null ? undefined : `${utilization.data.totals.completionRate}%`}
          sub={utilization.data && `${utilization.data.totals.completed} done · ${utilization.data.totals.missed} missed`}
        />
        <Tile
          label="EVV verified"
          value={evv.data?.verifiedRate == null ? undefined : `${evv.data.verifiedRate}%`}
          sub={evv.data && `${evv.data.awaitingReview} to review · ${evv.data.missing} without EVV`}
        />
        {financial.data && (
          <>
            <Tile label="Collected" value={money(financial.data.collected)} sub={`${money(financial.data.billed)} billed`} />
            <Tile label="Outstanding" value={money(financial.data.outstanding)} sub={`${financial.data.denied.claims} denied (${financial.data.denied.rate ?? 0}%)`} />
          </>
        )}
      </section>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Visits per day</h2>
          <button type="button" className="text-xs text-violet-800 underline" onClick={() => download.mutate('visit-utilization')}>
            Download CSV
          </button>
        </div>
        {utilization.data ? <VisitsChart daily={utilization.data.daily} /> : <p className="text-sm text-slate-500">Loading…</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold text-slate-900">Active patients by payer</h2>
          <ul aria-label="Active patients by payer" className="flex flex-col gap-2 text-sm">
            {census.data?.activeByPayer.map((p) => (
              <li key={p.payer} className="grid grid-cols-[9rem_1fr] items-center gap-3">
                <span className="truncate text-slate-700">{p.payer}</span>
                <span className="flex items-center gap-2">
                  <span className="h-4 rounded-r bg-[#2a78d6]" style={{ width: `${Math.max(2, (p.patients / maxPayer) * 85)}%` }} aria-hidden />
                  <span className="tabular-nums text-slate-900">{p.patients}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        {financial.data && (
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-900">Denials by reason</h2>
            {financial.data.denied.byReason.length === 0 ? (
              <p className="text-sm text-slate-500">No denials in this period.</p>
            ) : (
              <SimpleTable
                label="Denials by reason"
                head={['Reason code', 'Claims', 'Amount']}
                rows={financial.data.denied.byReason.map((d) => [d.reason, d.claims, money(d.amount)])}
              />
            )}
          </Card>
        )}
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Staff productivity</h2>
          <button type="button" className="text-xs text-violet-800 underline" onClick={() => download.mutate('staff-productivity')}>
            Download CSV
          </button>
        </div>
        <SimpleTable
          label="Staff productivity"
          head={['Staff', 'Discipline', 'Visits', 'Missed', 'Hours', 'Avg visit']}
          rows={(productivity.data?.rows ?? []).map((r) => [r.name, r.discipline, r.completedVisits, r.missedVisits, r.hours.toFixed(1), r.averageVisitMinutes === null ? '—' : `${r.averageVisitMinutes} min`])}
          empty="No visits in this period."
        />
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Missed and cancelled visits</h2>
          <button type="button" className="text-xs text-violet-800 underline" onClick={() => download.mutate('missed-visits')}>
            Download CSV
          </button>
        </div>
        <SimpleTable
          label="Missed and cancelled visits"
          head={['Date', 'Patient', 'Caregiver', 'Visit', 'Status', 'Reason']}
          rows={(missed.data?.rows ?? []).slice(0, 50).map((r) => [formatDate(r.date), r.patient, r.caregiver ?? '—', humanize(r.visitType), humanize(r.status), r.reason ?? '—'])}
          empty="None in this period."
        />
        {(missed.data?.rows.length ?? 0) > 50 && <p className="text-xs text-slate-500">Showing 50 — download the CSV for all {missed.data!.rows.length}.</p>}
      </Card>
    </div>
  );
}

function useReport<T>(name: string, qs: string, enabled: boolean) {
  const { request } = useAuth();
  // Keep the previous range on screen while the next loads (no flash, and the chart keeps its table/chart toggle).
  return useQuery({
    queryKey: ['reports', name, qs],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () => (await request<T>(`/reports/${name}?${qs}`)).data,
  });
}

function Tile({ label, value, sub }: { label: string; value: ReactNode | undefined; sub?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-0.5 p-4">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value ?? '—'}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

function SimpleTable({ label, head, rows, empty }: { label: string; head: string[]; rows: (string | number)[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty ?? 'Nothing to show.'}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={`py-2 pr-4 ${typeof c === 'number' ? 'tabular-nums' : ''}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
