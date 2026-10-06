'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ConflictList } from '@/components/schedule/conflict-list';
import { FindCaregiver } from '@/components/schedule/find-caregiver';
import { OfferOpenShift, VisitEvv, VisitRecords, VisitTasks } from '@/components/schedule/visit-documentation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatTime, humanize } from '@/lib/labels';
import type { StaffSummary } from '@/lib/types/people';
import type { ScheduleConflict, VisitView, VisitWithWarnings } from '@/lib/types/schedule';

export default function VisitPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<ScheduleConflict[]>([]);

  const visit = useQuery({
    queryKey: ['schedule', 'visit', id],
    queryFn: async () => (await request<VisitView>(`/schedule/visits/${id}`)).data,
  });
  const staff = useQuery({
    queryKey: ['staff', 'options'],
    enabled: can('staff:read') && can('visits:update'),
    queryFn: async () => (await request<StaffSummary[]>('/staff?isActive=true&limit=100')).data,
  });
  const change = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await request<VisitWithWarnings>(`/schedule/visits/${id}`, { method: 'PATCH', body })).data,
    onSuccess: async (data) => {
      setWarnings(data.warnings);
      await queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => request(`/schedule/visits/${id}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });

  if (visit.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!visit.data) return <ErrorAlert error={visit.error} />;
  const v = visit.data;
  const editable = v.status === 'scheduled' && can('visits:update');
  const conflictError = change.error instanceof ApiError && change.error.code === 'SCHEDULE_CONFLICT' ? change.error : null;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const staffId = String(form.get('staffId') ?? '');
    change.mutate({
      scheduledDate: form.get('scheduledDate'),
      scheduledStart: form.get('scheduledStart'),
      scheduledEnd: form.get('scheduledEnd'),
      staffId: staffId || null,
      ...(form.get('override') === 'on' ? { override: true } : {}),
    });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {humanize(v.visitType)} visit <StatusBadge status={v.status} />
          </span>
        }
        subtitle={`${formatDate(v.scheduledDate)}, ${formatTime(v.scheduledStart)}–${formatTime(v.scheduledEnd)}`}
      />

      <Card className="p-5">
        <DetailList
          items={[
            [
              'Patient',
              can('patients:read') ? (
                <Link href={`/patients/${v.patient.id}`} className="text-violet-800 hover:underline">
                  {v.patient.lastName}, {v.patient.firstName}
                </Link>
              ) : (
                `${v.patient.lastName}, ${v.patient.firstName}`
              ),
            ],
            ['Caregiver', v.staff ? `${v.staff.firstName} ${v.staff.lastName} (${v.staff.discipline})` : 'Unassigned'],
            ['Priority', humanize(v.priority)],
            ['Service code', v.serviceCode],
            ['Part of a recurring series', v.isRecurring ? 'Yes' : 'No'],
            ['Notes', v.notes],
            ['Cancellation reason', v.cancelReason],
          ]}
        />
      </Card>

      {warnings.length > 0 && <ConflictList conflicts={warnings} />}

      {v.status !== 'scheduled' && v.status !== 'cancelled' && <VisitEvv visitId={v.id} />}
      {v.status !== 'cancelled' && <VisitTasks visitId={v.id} status={v.status} />}
      {(v.status === 'in_progress' || v.status === 'completed') && <VisitRecords visitId={v.id} />}

      {editable && (
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Reschedule or reassign</h2>
          {!conflictError && <ErrorAlert error={change.error} />}
          {conflictError && (
            <div className="mb-3">
              <ConflictList conflicts={conflictError.details as ScheduleConflict[]} />
            </div>
          )}
          <form key={`${v.scheduledDate}${v.scheduledStart}${v.staff?.id}`} onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" name="scheduledDate" type="date" defaultValue={v.scheduledDate} required />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Start" name="scheduledStart" type="time" defaultValue={v.scheduledStart} required />
              <Field label="End" name="scheduledEnd" type="time" defaultValue={v.scheduledEnd} required />
            </div>
            {can('staff:read') && (
              <SelectField label="Caregiver" name="staffId" defaultValue={v.staff?.id ?? ''} className="sm:col-span-2">
                <option value="">Unassigned (open shift)</option>
                {staff.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName}, {s.firstName} ({s.discipline})
                  </option>
                ))}
              </SelectField>
            )}
            {conflictError && can('visits:approve') && (
              <label className="flex items-center gap-2 text-sm text-slate-800 sm:col-span-2">
                <input type="checkbox" name="override" /> Save anyway — I have checked these conflicts (audited)
              </label>
            )}
            <Button type="submit" disabled={change.isPending} className="sm:justify-self-start">
              Save changes
            </Button>
          </form>
        </Card>
      )}

      {editable && can('visits:assign') && <FindCaregiver visitId={v.id} currentStaffId={v.staff?.id ?? null} />}

      {editable && <OfferOpenShift visitId={v.id} assigned={Boolean(v.staff)} />}

      {editable && (
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Cancel visit</h2>
          <ErrorAlert error={cancel.error} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
              if (reason && window.confirm('Cancel this visit? The caregiver will be notified.')) cancel.mutate(reason);
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Reason" name="reason" required className="min-w-64 flex-1" placeholder="e.g. Patient in hospital" />
            <Button type="submit" variant="danger" disabled={cancel.isPending}>
              Cancel visit
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
