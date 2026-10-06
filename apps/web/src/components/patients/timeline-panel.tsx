'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, ClipboardList, FileText, Heart, Inbox, LogIn, LogOut, MapPin, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';

type Kind = 'referral' | 'admission' | 'discharge' | 'visit' | 'note' | 'evv' | 'incident' | 'care_update' | 'document';

interface TimelineEvent {
  at: string;
  kind: Kind;
  title: string;
  detail: string | null;
  link: string | null;
  tone: 'good' | 'warning' | 'neutral';
}

const ICONS: Record<Kind, LucideIcon> = {
  referral: Inbox,
  admission: LogIn,
  discharge: LogOut,
  visit: CalendarCheck,
  note: ClipboardList,
  evv: MapPin,
  incident: AlertTriangle,
  care_update: Heart,
  document: FileText,
};

const TONES = {
  good: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  neutral: 'bg-slate-100 text-slate-700',
};

const FILTERS: [string, Kind[] | null][] = [
  ['Everything', null],
  ['Visits & notes', ['visit', 'note', 'care_update']],
  ['Problems', ['incident', 'evv']],
];

/** A YYYY-MM-DD date moved by whole days. */
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The client's story in one place (D-100): newest first, last 90 days by default, only what the viewer may see. */
export function TimelinePanel({ patientId }: { patientId: string }) {
  const { request } = useAuth();
  const today = useAgencyToday();
  const [days, setDays] = useState(90);
  const [filter, setFilter] = useState(0);
  const timeline = useQuery({
    queryKey: ['patients', patientId, 'timeline', today, days],
    queryFn: async () => (await request<{ events: TimelineEvent[] }>(`/patients/${patientId}/timeline?from=${addDays(today, -(days - 1))}&to=${today}`)).data,
  });
  const kinds = FILTERS[filter]![1];
  const events = timeline.data?.events.filter((e) => !kinds || kinds.includes(e.kind)) ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold text-slate-900">Timeline</h2>
        {FILTERS.map(([label], i) => (
          <button
            key={label}
            type="button"
            aria-pressed={filter === i}
            onClick={() => setFilter(i)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === i ? 'bg-violet-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}
          >
            {label}
          </button>
        ))}
        <select aria-label="How far back" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
        </select>
      </div>
      <ErrorAlert error={timeline.error} />
      {timeline.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {timeline.data && events.length === 0 && <p className="text-sm text-slate-600">Nothing in this period.</p>}
      <ol className="flex flex-col gap-3">
        {events.map((e, i) => {
          const Icon = ICONS[e.kind];
          const body = (
            <>
              <p className="font-medium text-slate-900">{e.title}</p>
              {e.detail && <p className="text-slate-700">{e.detail}</p>}
              <p className="text-xs text-slate-500">{when(e.at)}</p>
            </>
          );
          return (
            <li key={`${e.kind}-${e.at}-${i}`} className="flex gap-3 text-sm">
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONES[e.tone]}`}>
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              {e.link ? (
                <Link href={e.link} className="block rounded-lg hover:bg-slate-50">
                  {body}
                </Link>
              ) : (
                <div>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
