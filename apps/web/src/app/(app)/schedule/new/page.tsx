'use client';

import { RECURRENCE_FREQUENCIES, VISIT_PRIORITIES, VISIT_TYPES } from '@alora/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ConflictList } from '@/components/schedule/conflict-list';
import { PatientPicker } from '@/components/schedule/patient-picker';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { dayName, humanize } from '@/lib/labels';
import type { StaffSummary } from '@/lib/types/people';
import type { GenerationResult, ScheduleConflict, VisitWithWarnings } from '@/lib/types/schedule';
import { useAgencyToday } from '@/lib/use-agency-today';

interface Draft {
  patientId: string;
  staffId: string;
  visitType: string;
  scheduledDate: string;
  scheduledStart: string;
  scheduledEnd: string;
}

/**
 * Book a visit (or a recurring series). Conflicts are checked live against the API as the form changes;
 * blocking ones stop the booking unless a supervisor overrides (audited).
 */
export default function BookVisitPage() {
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const [draft, setDraft] = useState<Draft>({
    patientId: '',
    staffId: '',
    visitType: 'home_health_aide',
    scheduledDate: today,
    scheduledStart: '09:00',
    scheduledEnd: '10:00',
  });
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [override, setOverride] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<GenerationResult | null>(null);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const staff = useQuery({
    queryKey: ['staff', 'options'],
    enabled: can('staff:read'),
    queryFn: async () => (await request<StaffSummary[]>('/staff?isActive=true&limit=100')).data,
  });

  // Live conflict check, debounced.
  const [checkKey, setCheckKey] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setCheckKey(JSON.stringify(draft)), 400);
    return () => clearTimeout(timer);
  }, [draft]);
  const ready = draft.patientId && draft.scheduledDate && draft.scheduledStart < draft.scheduledEnd;
  const conflicts = useQuery({
    queryKey: ['schedule', 'conflicts', checkKey],
    enabled: Boolean(ready && checkKey) && !repeat,
    queryFn: async () => {
      const d = JSON.parse(checkKey) as Draft;
      const params = new URLSearchParams({
        patientId: d.patientId,
        visitType: d.visitType,
        scheduledDate: d.scheduledDate,
        scheduledStart: d.scheduledStart,
        scheduledEnd: d.scheduledEnd,
      });
      if (d.staffId) params.set('staffId', d.staffId);
      return (await request<ScheduleConflict[]>(`/schedule/conflicts?${params}`)).data;
    },
  });
  const blocking = conflicts.data?.some((c) => c.severity === 'blocking') ?? false;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const common = {
        patientId: draft.patientId,
        ...(draft.staffId ? { staffId: draft.staffId } : {}),
        visitType: draft.visitType,
      };
      if (repeat) {
        const endDate = String(form.get('endDate') ?? '');
        const count = String(form.get('maxOccurrences') ?? '');
        const { data } = await request<{ generation: GenerationResult }>('/schedule/recurring', {
          method: 'POST',
          body: {
            ...common,
            frequency: form.get('frequency'),
            daysOfWeek: days,
            startTime: draft.scheduledStart,
            endTime: draft.scheduledEnd,
            startDate: draft.scheduledDate,
            ...(endDate ? { endDate } : {}),
            ...(count ? { maxOccurrences: Number(count) } : {}),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ['schedule'] });
        setReport(data.generation);
      } else {
        const notes = String(form.get('notes') ?? '').trim();
        const { data } = await request<VisitWithWarnings>('/schedule/visits', {
          method: 'POST',
          body: {
            ...common,
            scheduledDate: draft.scheduledDate,
            scheduledStart: draft.scheduledStart,
            scheduledEnd: draft.scheduledEnd,
            priority: form.get('priority'),
            ...(notes ? { notes } : {}),
            ...(override ? { override: true } : {}),
          },
        });
        await queryClient.invalidateQueries({ queryKey: ['schedule'] });
        router.push(`/schedule/visits/${data.id}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (report) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="Recurring visits booked" />
        <Alert tone="info">{report.created.length} visit(s) booked for the next four weeks. More are added as time goes on.</Alert>
        {report.skipped.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Dates not booked</h2>
            <p className="mb-3 text-sm text-slate-600">These dates clash with the schedule. Book them individually once resolved.</p>
            <ul className="flex flex-col gap-3">
              {report.skipped.map((s) => (
                <li key={s.date}>
                  <p className="text-sm font-medium">{formatDate(s.date)}</p>
                  <ConflictList conflicts={s.conflicts} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <ButtonLink href="/schedule" className="self-start">
          Back to the schedule
        </ButtonLink>
      </div>
    );
  }

  const scheduleConflict = error instanceof ApiError && error.code === 'SCHEDULE_CONFLICT';
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Book visit" />
      <form onSubmit={submit} className="flex flex-col gap-4">
        {!scheduleConflict && <ErrorAlert error={error} />}
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <PatientPicker value={draft.patientId} onChange={(patientId) => set({ patientId })} className="sm:col-span-2" />
          <SelectField label="Visit type" value={draft.visitType} onChange={(e) => set({ visitType: e.target.value })}>
            {VISIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Caregiver" value={draft.staffId} onChange={(e) => set({ staffId: e.target.value })}>
            <option value="">Unassigned (open shift)</option>
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.lastName}, {s.firstName} ({s.discipline})
              </option>
            ))}
          </SelectField>
          <Field label={repeat ? 'First date' : 'Date'} type="date" value={draft.scheduledDate} onChange={(e) => set({ scheduledDate: e.target.value })} required />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start" type="time" value={draft.scheduledStart} onChange={(e) => set({ scheduledStart: e.target.value })} required />
            <Field label="End" type="time" value={draft.scheduledEnd} onChange={(e) => set({ scheduledEnd: e.target.value })} required />
          </div>
          {!repeat && (
            <SelectField label="Priority" name="priority" defaultValue="normal">
              {VISIT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </SelectField>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat every week
          </label>
        </Card>

        {repeat ? (
          <Card className="grid gap-4 p-5 sm:grid-cols-2">
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-sm font-medium text-slate-800">On these days</legend>
              <div className="flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex items-center gap-1 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={days.includes(d)}
                      onChange={(e) => setDays(e.target.checked ? [...days, d] : days.filter((x) => x !== d))}
                    />
                    {dayName(d).slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <SelectField label="Frequency" name="frequency" defaultValue="weekly">
              {RECURRENCE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f === 'biweekly' ? 'Every other week' : 'Every week'}
                </option>
              ))}
            </SelectField>
            <Field label="Until (optional)" name="endDate" type="date" />
            <Field label="Or number of visits (optional)" name="maxOccurrences" type="number" min={1} />
          </Card>
        ) : (
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-semibold text-slate-900">Schedule check</h2>
            {!ready && <p className="text-sm text-slate-500">Choose a patient and a time to check for conflicts.</p>}
            {ready && conflicts.isFetching && <p className="text-sm text-slate-500">Checking…</p>}
            {ready && conflicts.data && conflicts.data.length === 0 && <p className="text-sm text-emerald-700">No conflicts.</p>}
            {conflicts.data && conflicts.data.length > 0 && <ConflictList conflicts={conflicts.data} />}
            {scheduleConflict && <ConflictList conflicts={(error as ApiError).details as ScheduleConflict[]} />}
            {(blocking || scheduleConflict) && can('visits:approve') && (
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                Book anyway — I have checked these conflicts (recorded in the audit log)
              </label>
            )}
            <TextAreaField label="Notes for the caregiver" name="notes" />
          </Card>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy || !draft.patientId || (repeat && days.length === 0) || (!repeat && blocking && !override)}
          >
            {busy ? 'Booking…' : repeat ? 'Book recurring visits' : 'Book visit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
