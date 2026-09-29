'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { clockTime, flagLabel, formatTime, humanize } from '@/lib/labels';
import type { EvvRecord } from '@/lib/types/evv';

type Clock = EvvRecord['clockIn'];

function clockItems(clock: Clock | null): [string, React.ReactNode][] {
  if (!clock) return [['Time', 'Not clocked out yet']];
  return [
    ['Time', clockTime(clock.time)],
    ['Method', clock.method ? humanize(clock.method) : '—'],
    [
      'Location',
      clock.withinGeofence === null
        ? 'Not checked (no home location)'
        : `${clock.distanceMeters ?? '?'} m from the home — ${clock.withinGeofence ? 'inside' : 'outside'} the geofence`,
    ],
    ['GPS accuracy', clock.accuracyMeters !== null ? `±${clock.accuracyMeters} m` : '—'],
  ];
}

/** One EVV record: what the device captured, why it's flagged, and the supervisor's decisions (D-038, D-042). */
export default function EvvRecordPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can, user } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const record = useQuery({
    queryKey: ['evv', 'record', id],
    queryFn: async () => (await request<EvvRecord>(`/evv/records/${id}`)).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['evv'] });
  const review = useMutation({
    mutationFn: (action: 'verify' | 'reject') =>
      request(`/evv/records/${id}/${action}`, { method: 'POST', body: note.trim() ? { note: note.trim() } : {} }),
    onSuccess: refresh,
  });
  const fileCorrection = useMutation({
    mutationFn: (body: Record<string, unknown>) => request(`/evv/records/${id}/exception`, { method: 'POST', body }),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: ({ exceptionId, status }: { exceptionId: string; status: 'approved' | 'denied' }) =>
      request(`/evv/exceptions/${exceptionId}`, { method: 'PATCH', body: { status } }),
    onSuccess: refresh,
  });

  if (record.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!record.data) return <ErrorAlert error={record.error} />;
  const r = record.data;
  const pending = r.exceptions.filter((e) => e.status === 'pending');
  const reviewable = (r.status === 'completed' || r.status === 'exception') && can('evv:approve');
  const correctable = ['in_progress', 'completed', 'exception'].includes(r.status) && can('evv:update');

  const submitCorrection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const local = String(form.get('correctedValue') ?? '');
    fileCorrection.mutate(
      {
        exceptionType: form.get('exceptionType'),
        correctedValue: local ? new Date(local).toISOString() : '',
        reason: form.get('reason'),
      },
      { onSuccess: () => (event.target as HTMLFormElement).reset() },
    );
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            EVV record <StatusBadge status={r.status} />
          </span>
        }
        subtitle={
          <>
            {formatDate(r.serviceDate)} · {r.staff.firstName} {r.staff.lastName} ({r.staff.discipline}) with{' '}
            {r.patient.firstName} {r.patient.lastName} ·{' '}
            <Link href={`/schedule/visits/${r.visit.id}`} className="text-violet-800 underline">
              {humanize(r.visit.visitType)} visit, {formatTime(r.visit.scheduledStart)}–{formatTime(r.visit.scheduledEnd)}
            </Link>
          </>
        }
      />

      {r.flags.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <h2 className="mb-1 font-semibold">Needs attention</h2>
          <ul className="list-disc pl-5">
            {r.flags.map((f) => (
              <li key={f}>{flagLabel(f)}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Clock in</h2>
          <DetailList items={clockItems(r.clockIn)} />
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Clock out</h2>
          <DetailList items={clockItems(r.clockOut)} />
        </Card>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold text-slate-900">Time corrections</h2>
        {r.exceptions.length === 0 && <p className="text-sm text-slate-500">None.</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {r.exceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
              <span>
                {e.exceptionType === 'clock_in_time' ? 'Clock-in' : 'Clock-out'}: {clockTime(e.originalValue)} →{' '}
                <strong>{clockTime(e.correctedValue)}</strong> — {e.reason} <StatusBadge status={e.status} />
              </span>
              {e.status === 'pending' && can('evv:approve') && e.requestedById !== user?.id && (
                <span className="flex gap-2">
                  <Button variant="secondary" onClick={() => decide.mutate({ exceptionId: e.id, status: 'approved' })}>
                    Approve
                  </Button>
                  <Button variant="ghost" onClick={() => decide.mutate({ exceptionId: e.id, status: 'denied' })}>
                    Deny
                  </Button>
                </span>
              )}
              {e.status === 'pending' && e.requestedById === user?.id && (
                <span className="text-xs text-slate-500">Someone else must decide your request</span>
              )}
            </li>
          ))}
        </ul>
        <ErrorAlert error={decide.error} />
        {correctable && (
          <form onSubmit={submitCorrection} className="flex flex-col gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm text-slate-600">
              Request a correction (e.g. the caregiver forgot to clock out). It changes nothing until another supervisor
              approves it.
            </p>
            <div className="flex flex-wrap gap-3">
              <SelectField label="Which time" name="exceptionType" defaultValue={r.clockOut ? 'clock_in_time' : 'clock_out_time'}>
                <option value="clock_in_time">Clock-in</option>
                <option value="clock_out_time">Clock-out</option>
              </SelectField>
              <Field label="Corrected time" name="correctedValue" type="datetime-local" required />
            </div>
            <TextAreaField label="Reason" name="reason" required placeholder="What happened, and how the time was confirmed" />
            <ErrorAlert error={fileCorrection.error} />
            <div>
              <Button type="submit" variant="secondary" disabled={fileCorrection.isPending}>
                Request correction
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-semibold text-slate-900">Review</h2>
        {r.verifiedAt ? (
          <p className="text-sm text-slate-700">
            {r.status === 'verified' ? 'Verified' : 'Rejected'} {new Date(r.verifiedAt).toLocaleString()}
            {r.verificationNote ? ` — “${r.verificationNote}”` : ''}
          </p>
        ) : r.status === 'in_progress' ? (
          <p className="text-sm text-slate-600">The caregiver is still clocked in.</p>
        ) : reviewable ? (
          <>
            {pending.length > 0 && <p className="text-sm text-amber-800">Decide the pending corrections first.</p>}
            <TextAreaField
              label="Note (required to reject)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Confirmed with the patient's daughter"
            />
            <ErrorAlert error={review.error} />
            <div className="flex gap-2">
              <Button disabled={pending.length > 0 || review.isPending} onClick={() => review.mutate('verify')}>
                Verify
              </Button>
              <Button
                variant="danger"
                disabled={pending.length > 0 || review.isPending || !note.trim()}
                onClick={() => review.mutate('reject')}
              >
                Reject
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-600">Not reviewed yet.</p>
        )}
      </Card>
    </div>
  );
}
