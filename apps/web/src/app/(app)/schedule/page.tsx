'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatTime, humanize } from '@/lib/labels';
import type { StaffSummary } from '@/lib/types/people';
import type { CalendarDay, VisitView } from '@/lib/types/schedule';
import { useAgencyToday } from '@/lib/use-agency-today';

/** Monday of the week containing `date` (YYYY-MM-DD). */
function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Week calendar of visits. Caregivers see only their own visits (the API scopes it). */
export default function SchedulePage() {
  const { request, can } = useAuth();
  const today = useAgencyToday();
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [staffId, setStaffId] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const weekEnd = addDays(weekStart, 6);

  const staff = useQuery({
    queryKey: ['staff', 'options'],
    enabled: can('staff:read'),
    queryFn: async () => (await request<StaffSummary[]>('/staff?isActive=true&limit=100')).data,
  });
  const calendar = useQuery({
    queryKey: ['schedule', 'calendar', weekStart, staffId],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ from: weekStart, to: weekEnd });
      if (staffId) params.set('staffId', staffId);
      return (await request<CalendarDay[]>(`/schedule/calendar?${params}`)).data;
    },
  });

  const show = (v: VisitView) => !onlyUnassigned || v.staff === null;
  const total = calendar.data?.reduce((n, day) => n + day.visits.filter(show).length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schedule"
        subtitle={`${formatDate(weekStart)} – ${formatDate(weekEnd)} · ${
          // While the new week loads, the previous week's data is still on screen — don't show its count as this week's.
          calendar.isPlaceholderData || !calendar.data ? 'loading…' : `${total} visit${total === 1 ? '' : 's'}`
        }`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              ←
            </Button>
            <Button variant="secondary" onClick={() => setWeekStart(mondayOf(today))}>
              This week
            </Button>
            <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              →
            </Button>
            {can('visits:create') && <ButtonLink href="/schedule/new">Book visit</ButtonLink>}
          </>
        }
      />

      {can('visits:read_all') && (
        <Card className="flex flex-wrap items-end gap-4 p-4">
          {can('staff:read') && (
            <SelectField label="Caregiver" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Everyone</option>
              {staff.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName}, {s.firstName} ({s.discipline})
                </option>
              ))}
            </SelectField>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
            Only unassigned visits
          </label>
        </Card>
      )}

      <ErrorAlert error={calendar.error} />

      <div className={`grid gap-3 md:grid-cols-7 ${calendar.isPlaceholderData ? 'opacity-50' : ''}`} aria-busy={calendar.isPlaceholderData}>
        {calendar.data?.map((day) => {
          const visits = day.visits.filter(show);
          return (
            <section
              key={day.date}
              aria-label={WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}
              className={`flex min-h-32 flex-col gap-2 rounded-lg border p-2 ${day.date === today ? 'border-teal-600 bg-teal-50/40' : 'border-slate-200 bg-white'}`}
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                {WEEKDAY.format(new Date(`${day.date}T00:00:00Z`))}
              </h2>
              {visits.map((v) => (
                <Link
                  key={v.id}
                  href={`/schedule/visits/${v.id}`}
                  className={`rounded-md border px-2 py-1.5 text-xs hover:border-teal-400 ${v.staff ? 'border-slate-200 bg-slate-50' : 'border-dashed border-amber-400 bg-amber-50'}`}
                >
                  <span className="block font-medium text-slate-900">
                    {formatTime(v.scheduledStart)}–{formatTime(v.scheduledEnd)}
                  </span>
                  <span className="block text-slate-800">
                    {v.patient.lastName}, {v.patient.firstName}
                  </span>
                  <span className="block text-slate-600">
                    {v.staff ? `${v.staff.firstName} ${v.staff.lastName}` : 'Unassigned'} · {humanize(v.visitType)}
                  </span>
                  {v.priority !== 'normal' && <span className="font-medium text-red-700">{humanize(v.priority)} priority</span>}
                </Link>
              ))}
              {visits.length === 0 && <p className="text-xs text-slate-400">No visits</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
