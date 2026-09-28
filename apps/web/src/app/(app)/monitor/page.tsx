'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatTime, humanize } from '@/lib/labels';
import { useLiveSocket } from '@/lib/realtime';
import type { LiveSnapshot, MonitorEvent } from '@/lib/types/evv';

const LiveMap = dynamic(() => import('@/components/monitor/live-map'), {
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse rounded-lg bg-slate-100" />,
});

const EVENT_TEXT: Record<string, (e: MonitorEvent) => string> = {
  'visit:clock-in': (e) =>
    `${e.staffName ?? 'A caregiver'} clocked in with ${e.patientName ?? 'a patient'}${e.withinGeofence === false ? ' — away from the home' : ''}`,
  'visit:clock-out': (e) =>
    `${e.staffName ?? 'A caregiver'} clocked out${e.durationMinutes !== undefined ? ` after ${e.durationMinutes} min` : ''}`,
  'visit:geofence-violation': (e) =>
    `Geofence: ${e.staffName ?? 'a caregiver'} was ${e.distanceMeters ?? '?'} m from the home at ${e.stage ?? 'clock event'}`,
  'visit:late': (e) => `${e.staffName ?? 'A caregiver'} is ${e.minutesLate} min late for ${e.patientName ?? 'a visit'}`,
  'visit:noshow': (e) => `No-show: ${e.staffName ?? 'a caregiver'} hasn't clocked in (${e.minutesLate} min)`,
  'visit:missed': (e) => `Missed: the visit with ${e.patientName ?? 'a patient'} was never started`,
};

const ALERT_EVENTS = new Set(['visit:geofence-violation', 'visit:noshow', 'visit:missed']);

interface FeedItem {
  key: string;
  event: string;
  text: string;
  visitId: string;
  at: string;
}

/**
 * Live visit monitor (DESIGN.md §8.3, DECISIONS D-042): today's counts, a map of active visits, late/no-show and
 * unassigned lists, and a live feed. Socket events trigger a refetch of GET /evv/live — the snapshot is the truth.
 */
export default function MonitorPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const allowed = can('evv:read');

  const snapshot = useQuery({
    queryKey: ['evv', 'live'],
    enabled: allowed,
    queryFn: async () => (await request<LiveSnapshot>('/evv/live')).data,
    refetchInterval: 60_000, // late/no-show thresholds pass with the clock, not only with events
  });

  const onEvent = useCallback(
    (event: string) => (payload: MonitorEvent) => {
      const text = EVENT_TEXT[event]?.(payload);
      if (text) {
        setFeed((items) =>
          [{ key: `${event}-${payload.visitId}-${payload.at}`, event, text, visitId: payload.visitId, at: payload.at }, ...items].slice(0, 50),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['evv', 'live'] });
    },
    [queryClient],
  );
  const live = useLiveSocket(
    '/live-monitor',
    Object.fromEntries(Object.keys(EVENT_TEXT).map((e) => [e, onEvent(e)])),
    allowed,
  );

  if (!allowed) {
    return <PageHeader title="Live monitor" subtitle="You don't have access to the live monitor." />;
  }
  const data = snapshot.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Live monitor"
        subtitle={
          <span>
            {data ? `Today, ${data.date}` : 'Loading…'} ·{' '}
            <span className={live === 'live' ? 'text-teal-700' : 'text-amber-700'} aria-live="polite">
              {live === 'live' ? '● Live' : live === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
          </span>
        }
      />
      <ErrorAlert error={snapshot.error} />

      {data && (
        <>
          <section aria-label="Today's counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Count label="Scheduled" value={data.counts.scheduled} />
            <Count label="In progress" value={data.counts.inProgress} tone="teal" />
            <Count label="Completed" value={data.counts.completed} />
            <Count label="Late" value={data.counts.late} tone={data.counts.late ? 'amber' : undefined} />
            <Count label="No-show" value={data.counts.noShow} tone={data.counts.noShow ? 'red' : undefined} />
            <Count label="Missed" value={data.counts.missed} tone={data.counts.missed ? 'red' : undefined} />
            <Count label="Unassigned" value={data.counts.unassigned} tone={data.counts.unassigned ? 'amber' : undefined} />
            <Count label="EVV to review" value={data.counts.needsReview} href="/evv?needsReview=true" />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="flex flex-col gap-3 lg:col-span-2">
              <LiveMap active={data.active} />
              <Card className="p-4">
                <h2 className="mb-2 font-semibold text-slate-900">On a visit now ({data.active.length})</h2>
                {data.active.length === 0 ? (
                  <p className="text-sm text-slate-500">Nobody is clocked in.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {data.active.map((a) => (
                      <li key={a.evvRecordId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link href={`/schedule/visits/${a.visitId}`} className="text-teal-800 underline">
                          {a.staff.firstName} {a.staff.lastName} ({a.staff.discipline}) with {a.patient.firstName}{' '}
                          {a.patient.lastName}
                        </Link>
                        <span className="text-slate-600">
                          since {a.clockInTime ? new Date(a.clockInTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'} ·
                          ends {formatTime(a.scheduledEnd)}
                          {a.flags.length > 0 && <span className="ml-2 text-red-700">{a.flags.map(humanize).join(', ')}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="flex flex-col gap-3">
              <Card className="p-4">
                <h2 className="mb-2 font-semibold text-slate-900">Late and no-show ({data.late.length})</h2>
                {data.late.length === 0 ? (
                  <p className="text-sm text-slate-500">Everyone is on time.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {data.late.map((l) => (
                      <li key={l.visitId}>
                        <Link href={`/schedule/visits/${l.visitId}`} className={l.noShow ? 'text-red-800 underline' : 'text-amber-900 underline'}>
                          {l.noShow ? 'No-show' : 'Late'} {l.minutesLate} min: {l.staff.firstName} {l.staff.lastName} →{' '}
                          {l.patient.firstName} {l.patient.lastName} ({formatTime(l.scheduledStart)})
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-4">
                <h2 className="mb-2 font-semibold text-slate-900">Unassigned today ({data.unassigned.length})</h2>
                {data.unassigned.length === 0 ? (
                  <p className="text-sm text-slate-500">Every visit has a caregiver.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {data.unassigned.map((u) => (
                      <li key={u.visitId}>
                        <Link href={`/schedule/visits/${u.visitId}`} className="text-teal-800 underline">
                          {formatTime(u.scheduledStart)} {humanize(u.visitType)} — {u.patient.firstName} {u.patient.lastName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-4">
                <h2 className="mb-2 font-semibold text-slate-900">Live feed</h2>
                {feed.length === 0 ? (
                  <p className="text-sm text-slate-500">Events appear here as they happen.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm" aria-live="polite" aria-label="Live events">
                    {feed.map((f) => (
                      <li key={f.key} className={ALERT_EVENTS.has(f.event) ? 'text-red-800' : 'text-slate-700'}>
                        <span className="text-slate-500">
                          {new Date(f.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>{' '}
                        <Link href={`/schedule/visits/${f.visitId}`} className="underline">
                          {f.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Count({ label, value, tone, href }: { label: string; value: number; tone?: 'teal' | 'amber' | 'red'; href?: string }) {
  const color = tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-700' : tone === 'teal' ? 'text-teal-700' : 'text-slate-900';
  const body = (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-2xl font-semibold ${color}`}>{value}</span>
    </Card>
  );
  return href ? (
    <Link href={href} aria-label={`${label}: ${value}`}>
      {body}
    </Link>
  ) : (
    body
  );
}
