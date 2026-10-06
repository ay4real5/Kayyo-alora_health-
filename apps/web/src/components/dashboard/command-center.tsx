'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Info, Sparkles, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';

type Severity = 'critical' | 'warning' | 'info';

interface AttentionItem {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  amount?: number;
  link: string;
}

interface AuthorizationRisk {
  id: string;
  patient: { id: string; firstName: string; lastName: string };
  payer: string;
  serviceCode: string | null;
  endDate: string;
  unit: 'hours' | 'visits';
  authorized: number;
  used: number;
  booked: number;
  forecast: { projected: number | null; overBy: number; runsOutOn: string | null; level: 'over' | 'near' | 'ok' };
  link: string;
}

export interface CommandCenterData {
  today: string;
  attention: AttentionItem[];
  coverage?: { unassignedToday: number; unassignedTomorrow: number; openShifts: number; unassigned: { id: string; date: string; start: string; end: string; visitType: string; patient: string; link: string }[] };
  authorizations?: { atRisk: AuthorizationRisk[] };
  money?: {
    expectedToday: number;
    visitsToday: number;
    unpricedToday: number;
    atRisk: { total: number; visits: number; days: number; byReason: { reason: string; label: string; amount: number; visits: number }[] };
  };
}

const SEVERITY: Record<Severity, { icon: LucideIcon; tone: string; label: string }> = {
  critical: { icon: CircleAlert, tone: 'text-rose-700 bg-rose-50', label: 'Urgent' },
  warning: { icon: AlertTriangle, tone: 'text-amber-800 bg-amber-50', label: 'Soon' },
  info: { icon: Info, tone: 'text-brand-700 bg-brand-50', label: 'FYI' },
};

const dollars = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Opens the assistant panel with a question (the panel listens for this event). */
export function askPrimordial(question: string) {
  window.dispatchEvent(new CustomEvent('primordial:ask', { detail: question }));
}

/**
 * The Command Center (D-093): what needs attention today, money, and authorizations at risk — each section only for
 * people whose role can see it (the API leaves the rest out).
 */
export function CommandCenter() {
  const { request, can } = useAuth();
  const data = useQuery({
    queryKey: ['insights', 'command-center'],
    queryFn: async () => (await request<CommandCenterData>('/insights/command-center')).data,
    refetchInterval: 5 * 60_000,
  });
  const assistant = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: async () => (await request<{ enabled: boolean }>('/assistant/status')).data,
    enabled: can('assistant:use'),
    staleTime: 5 * 60_000,
  });
  const c = data.data;
  if (data.error) return <ErrorAlert error={data.error} />;
  if (!c) return <p className="text-sm text-slate-600">Loading today’s overview…</p>;
  const hasAnySection = Boolean(c.coverage || c.money || c.authorizations);
  if (!hasAnySection && c.attention.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">Needs attention</h2>
          {assistant.data?.enabled && (
            <button
              type="button"
              onClick={() => askPrimordial('What should I worry about today?')}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
            >
              <Sparkles aria-hidden className="h-4 w-4" /> Ask Primordial about today
            </button>
          )}
        </div>
        {c.attention.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            <CheckCircle2 aria-hidden className="h-5 w-5" /> All clear — nothing needs attention right now.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {c.attention.map((a) => {
              const s = SEVERITY[a.severity];
              const Icon = s.icon;
              return (
                <li key={a.key}>
                  <Link href={a.link} className="group flex items-start gap-3 rounded-xl px-2 py-3 hover:bg-slate-50">
                    <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${s.tone}`}>
                      <Icon aria-hidden className="h-4 w-4" />
                      <span className="sr-only">{s.label}:</span>
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{a.title}</span>
                      <span className="block text-sm text-slate-600">{a.detail}</span>
                    </span>
                    <ArrowRight aria-hidden className="mt-2 h-4 w-4 text-slate-400 group-hover:text-brand-700" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex flex-col gap-4">
        {c.money && (
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-900">Money</h2>
            <div>
              <p className="text-sm text-slate-600">
                Expected from today’s {c.money.visitsToday === 1 ? 'visit' : `${c.money.visitsToday} visits`}
              </p>
              <p className="text-2xl font-semibold text-ink">{dollars(c.money.expectedToday)}</p>
              {c.money.unpricedToday > 0 && (
                <p className="text-xs text-amber-800">
                  {c.money.unpricedToday === 1 ? '1 visit has' : `${c.money.unpricedToday} visits have`} no service code or rate, so isn’t counted.
                </p>
              )}
            </div>
            <div>
              <p className="text-sm text-slate-600">Can’t be billed yet (last {c.money.atRisk.days} days)</p>
              <p className={`text-2xl font-semibold ${c.money.atRisk.total > 0 ? 'text-rose-700' : 'text-ink'}`}>{dollars(c.money.atRisk.total)}</p>
            </div>
            {c.money.atRisk.byReason.length > 0 && (
              <ul className="flex flex-col gap-1.5 text-sm">
                {c.money.atRisk.byReason.slice(0, 5).map((r) => (
                  <li key={r.reason} className="flex justify-between gap-2">
                    <span className="text-slate-700">
                      {r.label} <span className="text-slate-600">({r.visits})</span>
                    </span>
                    <span className="font-medium text-slate-900">{dollars(r.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/billing/ready" className="text-sm font-medium text-brand-800 underline">
              Fix in Ready to bill
            </Link>
          </Card>
        )}
        {c.coverage && c.coverage.unassigned.length > 0 && (
          <Card className="flex flex-col gap-2 p-5">
            <h2 className="text-base font-semibold text-slate-900">Visits without a caregiver</h2>
            <ul className="flex flex-col gap-1.5 text-sm">
              {c.coverage.unassigned.map((v) => (
                <li key={v.id}>
                  <Link href={v.link} className="flex justify-between gap-2 rounded-lg px-1 py-0.5 hover:bg-slate-50">
                    <span className="text-slate-900">{v.patient}</span>
                    <span className="text-slate-600">
                      {v.date === c.today ? 'Today' : shortDate(v.date)} {v.start}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {c.authorizations && c.authorizations.atRisk.length > 0 && (
        <Card className="overflow-x-auto p-5 lg:col-span-3">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Authorizations at risk</h2>
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="pb-2 font-semibold">Patient</th>
                <th className="pb-2 font-semibold">Payer</th>
                <th className="pb-2 font-semibold">Approved</th>
                <th className="pb-2 font-semibold">Used / booked</th>
                <th className="pb-2 font-semibold">On pace for</th>
                <th className="pb-2 font-semibold">Runs out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.authorizations.atRisk.map((a) => (
                <tr key={`${a.id}-${a.unit}`}>
                  <td className="py-2">
                    <Link href={a.link} className="font-medium text-brand-800 underline">
                      {a.patient.firstName} {a.patient.lastName}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-700">
                    {a.payer}
                    {a.serviceCode ? ` · ${a.serviceCode}` : ''}
                  </td>
                  <td className="py-2 text-slate-700">
                    {a.authorized} {humanize(a.unit).toLowerCase()} until {shortDate(a.endDate)}
                  </td>
                  <td className="py-2 text-slate-700">
                    {a.used} / {a.booked}
                  </td>
                  <td className={`py-2 font-medium ${a.forecast.level === 'over' ? 'text-rose-700' : 'text-amber-800'}`}>
                    {a.forecast.projected}
                    {a.forecast.overBy > 0 ? ` (+${a.forecast.overBy})` : ''}
                  </td>
                  <td className="py-2 text-slate-700">{a.forecast.runsOutOn ? shortDate(a.forecast.runsOutOn) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
