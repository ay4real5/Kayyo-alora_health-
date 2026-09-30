'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ConflictList } from '@/components/schedule/conflict-list';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ErrorAlert,
  PageHeader,
  Pager,
  StatusBadge,
  formatDate,
} from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { formatTime, humanize } from '@/lib/labels';
import type { OpenShift, ShiftSwap } from '@/lib/types/evv';
import type { StaffSummary, TimeOffRequest } from '@/lib/types/people';
import type { ScheduleConflict } from '@/lib/types/schedule';

/** Open shifts and shift swap requests for schedulers (DECISIONS D-040, D-042). Caregivers claim in the app. */
export default function OpenShiftsPage() {
  const { can } = useAuth();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Open shifts and swaps"
        subtitle="Visits offered to caregivers, and caregivers' requests to hand a visit on."
      />
      <OpenShiftList />
      {can('visits:approve') && <SwapRequests />}
      {can('visits:approve') && <TimeOffRequests />}
    </div>
  );
}

function OpenShiftList() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [assigning, setAssigning] = useState<string | null>(null);

  const shifts = useQuery({
    queryKey: ['schedule', 'open-shifts', { status, page }],
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<OpenShift[]>(
        `/schedule/open-shifts?${new URLSearchParams({ status, page: String(page), limit: '25' })}`,
      ),
  });
  const staff = useQuery({
    queryKey: ['staff', 'options'],
    enabled: can('staff:read') && can('visits:assign'),
    queryFn: async () => (await request<StaffSummary[]>('/staff?isActive=true&limit=100')).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['schedule'] });
  const act = useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'broadcast' | 'cancel' | 'assign';
      body?: Record<string, unknown>;
    }) =>
      request<{ notified?: number }>(`/schedule/open-shifts/${id}/${action}`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: async (_data, vars) => {
      if (vars.action === 'assign') setAssigning(null);
      await refresh();
    },
  });
  const conflict =
    act.error instanceof ApiError && act.error.code === 'SCHEDULE_CONFLICT' ? act.error : null;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">Open shifts</h2>
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="open">Open</option>
          <option value="filled">Filled</option>
          <option value="cancelled">Cancelled</option>
        </SelectField>
      </div>
      {!conflict && <ErrorAlert error={shifts.error ?? act.error} />}
      {conflict && <ConflictList conflicts={conflict.details as ScheduleConflict[]} />}
      {act.data?.data.notified !== undefined && (
        <p className="text-sm text-violet-800" role="status">
          Notified {act.data.data.notified} caregiver{act.data.data.notified === 1 ? '' : 's'}.
        </p>
      )}
      {shifts.data?.data.length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      <ul className="divide-y divide-slate-100" aria-label="Open shifts">
        {shifts.data?.data.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <Link
                  href={`/schedule/visits/${s.visit.id}`}
                  className="font-medium text-violet-800 underline"
                >
                  {formatDate(s.visit.scheduledDate)}, {formatTime(s.visit.scheduledStart)}–
                  {formatTime(s.visit.scheduledEnd)} · {humanize(s.visit.visitType)}
                </Link>{' '}
                · {s.patient ? `${s.patient.lastName}, ${s.patient.firstName}` : ''} ·{' '}
                {s.area.city ?? ''} · {s.visit.disciplines.join('/')}
                {s.expired ? <span className="ml-2 text-amber-800">expired</span> : null}
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={s.status} />
                {s.filledBy && (
                  <span className="text-slate-600">
                    {s.filledBy.how} by {s.filledBy.firstName} {s.filledBy.lastName}
                  </span>
                )}
              </span>
            </div>
            {s.notes && <p className="text-slate-600">{s.notes}</p>}
            {s.status === 'open' && (
              <div className="flex flex-wrap items-end gap-2">
                {can('notifications:create') && (
                  <Button
                    variant="secondary"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: s.id, action: 'broadcast' })}
                  >
                    {s.broadcastAt ? 'Notify again' : 'Notify caregivers'}
                  </Button>
                )}
                {can('visits:assign') && assigning !== s.id && (
                  <Button variant="secondary" onClick={() => setAssigning(s.id)}>
                    Assign…
                  </Button>
                )}
                {assigning === s.id && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      act.mutate({
                        id: s.id,
                        action: 'assign',
                        body: {
                          staffId: form.get('staffId'),
                          ...(form.get('override') === 'on' ? { override: true } : {}),
                        },
                      });
                    }}
                  >
                    <SelectField label="Caregiver" name="staffId" required>
                      <option value="">Choose…</option>
                      {staff.data
                        ?.filter((c) => s.visit.disciplines.includes(c.discipline))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.lastName}, {c.firstName} ({c.discipline})
                          </option>
                        ))}
                    </SelectField>
                    {conflict && can('visits:approve') && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" name="override" /> Assign anyway (audited)
                      </label>
                    )}
                    <Button type="submit" disabled={act.isPending}>
                      Assign
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setAssigning(null)}>
                      Close
                    </Button>
                  </form>
                )}
                {can('visits:update') && (
                  <Button
                    variant="ghost"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: s.id, action: 'cancel' })}
                  >
                    Withdraw offer
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {shifts.data?.meta && (
        <Pager
          page={shifts.data.meta.page}
          limit={shifts.data.meta.limit}
          total={shifts.data.meta.total}
          onPage={setPage}
        />
      )}
    </Card>
  );
}

function SwapRequests() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const swaps = useQuery({
    queryKey: ['schedule', 'swaps', 'pending'],
    queryFn: async () =>
      (await request<ShiftSwap[]>('/schedule/shift-swaps?status=pending&limit=100')).data,
  });
  const decide = useMutation({
    mutationFn: ({
      id,
      status,
      override,
    }: {
      id: string;
      status: 'approved' | 'denied';
      override?: boolean;
    }) =>
      request(`/schedule/shift-swaps/${id}`, {
        method: 'PATCH',
        body: { status, ...(override ? { override } : {}) },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });
  const conflict =
    decide.error instanceof ApiError && decide.error.code === 'SCHEDULE_CONFLICT'
      ? decide.error
      : null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">
        Swap requests waiting for a decision
      </h2>
      {!conflict && <ErrorAlert error={swaps.error ?? decide.error} />}
      {conflict && <ConflictList conflicts={conflict.details as ScheduleConflict[]} />}
      {swaps.data?.length === 0 && <p className="text-sm text-slate-500">None.</p>}
      <ul className="divide-y divide-slate-100 text-sm" aria-label="Swap requests">
        {swaps.data?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {s.requesting.firstName} {s.requesting.lastName} →{' '}
              {s.target
                ? `${s.target.firstName} ${s.target.lastName}`
                : 'back to the pool (open shift)'}{' '}
              ·{' '}
              <Link href={`/schedule/visits/${s.visit.id}`} className="text-violet-800 underline">
                {formatDate(s.visit.scheduledDate)} {formatTime(s.visit.scheduledStart)}
              </Link>
              {s.reason && <span className="text-slate-600"> — “{s.reason}”</span>}
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: s.id, status: 'approved' })}
              >
                Approve
              </Button>
              {conflict && (
                <Button
                  variant="secondary"
                  onClick={() => decide.mutate({ id: s.id, status: 'approved', override: true })}
                >
                  Approve anyway (audited)
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: s.id, status: 'denied' })}
              >
                Deny
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Pending time-off requests for supervisors (D-090); booked visits in the range still need a caregiver. */
function TimeOffRequests() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ['time-off', 'pending'],
    queryFn: async () => (await request<TimeOffRequest[]>('/time-off?status=pending&limit=100')).data,
  });
  const decide = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'approved' | 'denied' }) =>
      request(`/time-off/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['time-off'] }),
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Time off waiting for a decision</h2>
      <ErrorAlert error={requests.error ?? decide.error} />
      {requests.data?.length === 0 && <p className="text-sm text-slate-500">None.</p>}
      <ul className="divide-y divide-slate-100 text-sm" aria-label="Time off requests">
        {requests.data?.map((t) => (
          <li key={t.id} className="flex flex-col gap-1 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t.staff.firstName} {t.staff.lastName} ({t.staff.discipline}) · {formatDate(t.startDate)} –{' '}
                {formatDate(t.endDate)} · {t.days} day{t.days === 1 ? '' : 's'} · {humanize(t.type)}
                {t.notes && <span className="text-slate-600"> — “{t.notes}”</span>}
              </span>
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: t.id, status: 'approved' })}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: t.id, status: 'denied' })}
                >
                  Deny
                </Button>
              </span>
            </div>
            {(t.bookedVisits ?? 0) > 0 && (
              <p className="text-xs text-amber-800" role="alert">
                {t.bookedVisits} visit{t.bookedVisits === 1 ? '' : 's'} booked in these days need another caregiver.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
