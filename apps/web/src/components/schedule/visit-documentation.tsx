'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, StatusBadge } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { clockTime, flagLabel, humanize } from '@/lib/labels';
import type { EvvRecord, OpenShift, VisitNote, VisitTask, Vital } from '@/lib/types/evv';

/** EVV summary for a visit (supervisors). */
export function VisitEvv({ visitId }: { visitId: string }) {
  const { request, can } = useAuth();
  const records = useQuery({
    queryKey: ['evv', 'records', 'visit', visitId],
    enabled: can('evv:read'),
    queryFn: async () => (await request<EvvRecord[]>(`/evv/records?visitId=${visitId}`)).data,
  });
  if (!can('evv:read')) return null;
  const r = records.data?.[0];
  return (
    <Card className="p-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Electronic visit verification</h2>
      <ErrorAlert error={records.error} />
      {!r ? (
        <p className="text-sm text-slate-500">
          {records.isLoading ? 'Loading…' : 'Not clocked in yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          <p className="flex items-center gap-2">
            <StatusBadge status={r.status} /> In {clockTime(r.clockIn.time)} · Out{' '}
            {clockTime(r.clockOut?.time)}
          </p>
          {r.flags.length > 0 && (
            <p className="text-amber-900">{r.flags.map(flagLabel).join('; ')}</p>
          )}
          <Link href={`/evv/${r.id}`} className="text-teal-800 underline">
            Open the EVV record
          </Link>
        </div>
      )}
    </Card>
  );
}

/** The visit's task checklist: the office sets it up; the caregiver ticks it off in the app. */
export function VisitTasks({ visitId, status }: { visitId: string; status: string }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const key = ['schedule', 'visit', visitId, 'tasks'];
  const tasks = useQuery({
    queryKey: key,
    queryFn: async () => (await request<VisitTask[]>(`/schedule/visits/${visitId}/tasks`)).data,
  });
  const add = useMutation({
    mutationFn: (taskName: string) =>
      request(`/schedule/visits/${visitId}/tasks`, {
        method: 'POST',
        body: { tasks: [{ taskName }] },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (taskId: string) =>
      request(`/schedule/visits/${visitId}/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const editable = can('visits:update') && (status === 'scheduled' || status === 'in_progress');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('taskName') ?? '').trim();
    if (name) add.mutate(name, { onSuccess: () => form.reset() });
  };

  return (
    <Card className="p-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Tasks</h2>
      <ErrorAlert error={tasks.error ?? remove.error} />
      {tasks.data?.length === 0 && (
        <p className="text-sm text-slate-500">No tasks for this visit.</p>
      )}
      <ul className="flex flex-col gap-1 text-sm" aria-label="Visit tasks">
        {tasks.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2">
            <span>
              <span aria-hidden>
                {t.state === 'done' ? '✓' : t.state === 'not_done' ? '✗' : '○'}
              </span>{' '}
              {t.taskName}
              {t.description && <span className="text-slate-500"> — {t.description}</span>}
              {t.state === 'not_done' && (
                <span className="text-amber-800"> (not done: {t.notDoneReason})</span>
              )}
            </span>
            {editable && t.state === 'open' && (
              <Button
                variant="ghost"
                onClick={() => remove.mutate(t.id)}
                aria-label={`Remove ${t.taskName}`}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
          <Field
            label="New task"
            name="taskName"
            className="min-w-64 flex-1"
            placeholder="e.g. Assist with bathing"
            maxLength={255}
          />
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            Add task
          </Button>
          <ErrorAlert error={add.error} />
        </form>
      )}
    </Card>
  );
}

function vitalText(v: Vital): string {
  const parts = [
    v.bloodPressureSystolic !== null
      ? `BP ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`
      : null,
    v.heartRate !== null ? `HR ${v.heartRate}` : null,
    v.respiratoryRate !== null ? `RR ${v.respiratoryRate}` : null,
    v.temperature !== null ? `Temp ${v.temperature} °${v.temperatureUnit}` : null,
    v.oxygenSaturation !== null ? `SpO₂ ${v.oxygenSaturation}%` : null,
    v.weight !== null ? `Weight ${v.weight} ${v.weightUnit}` : null,
    v.painLevel !== null ? `Pain ${v.painLevel}/10` : null,
    v.bloodGlucose !== null ? `Glucose ${v.bloodGlucose} mg/dL` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Vitals and notes the caregiver recorded (read-only here; written in the caregiver app). */
export function VisitRecords({ visitId }: { visitId: string }) {
  const { request } = useAuth();
  const vitals = useQuery({
    queryKey: ['schedule', 'visit', visitId, 'vitals'],
    queryFn: async () => (await request<Vital[]>(`/schedule/visits/${visitId}/vitals`)).data,
  });
  const notes = useQuery({
    queryKey: ['schedule', 'visit', visitId, 'notes'],
    queryFn: async () => (await request<VisitNote[]>(`/schedule/visits/${visitId}/notes`)).data,
  });
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="mb-2 text-base font-semibold text-slate-900">Vitals</h2>
        <ErrorAlert error={vitals.error} />
        {vitals.data?.length === 0 && <p className="text-sm text-slate-500">None recorded.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {vitals.data?.map((v) => (
            <li key={v.id} className={v.enteredInError ? 'text-slate-400 line-through' : ''}>
              {clockTime(v.recordedAt)}: {vitalText(v)}
              {v.notes && ` — ${v.notes}`}
              {v.enteredInError && (
                <span className="no-underline"> (entered in error: {v.enteredInError.reason})</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 text-base font-semibold text-slate-900">Notes</h2>
        <ErrorAlert error={notes.error} />
        {notes.data?.length === 0 && <p className="text-sm text-slate-500">None written.</p>}
        <ul className="flex flex-col gap-3 text-sm">
          {notes.data?.map((n) => (
            <li key={n.id} className="rounded-md border border-slate-200 p-3">
              <p className="mb-1 flex items-center gap-2 text-slate-600">
                {humanize(n.noteType)} by {n.author.firstName} {n.author.lastName}{' '}
                <StatusBadge status={n.status} />
                {n.amendsNoteId && <span className="text-xs">(addendum)</span>}
              </p>
              {(
                [
                  ['Subjective', n.subjective],
                  ['Objective', n.objective],
                  ['Assessment', n.assessment],
                  ['Plan', n.plan],
                  ['Narrative', n.narrative],
                ] as const
              )
                .filter(([, text]) => text)
                .map(([label, text]) => (
                  <p key={label} className="whitespace-pre-wrap">
                    <span className="font-medium">{label}:</span> {text}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** Offers a scheduled visit to caregivers (a call-out takes the assigned caregiver off it) and broadcasts it. */
export function OfferOpenShift({ visitId, assigned }: { visitId: string; assigned: boolean }) {
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const offer = useMutation({
    mutationFn: async () => {
      const shift = (
        await request<OpenShift>('/schedule/open-shifts', {
          method: 'POST',
          body: { visitId, ...(notes.trim() ? { notes: notes.trim() } : {}) },
        })
      ).data;
      if (can('notifications:create'))
        await request(`/schedule/open-shifts/${shift.id}/broadcast`, { method: 'POST' });
      return shift;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
      router.push('/schedule/open-shifts');
    },
  });
  if (!can('visits:create')) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">Offer as an open shift</h2>
      <p className="mb-3 text-sm text-slate-600">
        Eligible caregivers are notified and can claim it; the first to claim gets it.
        {assigned && ' The current caregiver will be taken off this visit and told.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !assigned ||
            window.confirm('Take the caregiver off this visit and offer it to others?')
          )
            offer.mutate();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <Field
          label="Note for caregivers (no patient details)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-w-64 flex-1"
          maxLength={1000}
        />
        <Button type="submit" variant="secondary" disabled={offer.isPending}>
          Offer and notify
        </Button>
      </form>
      <ErrorAlert error={offer.error} />
    </Card>
  );
}
