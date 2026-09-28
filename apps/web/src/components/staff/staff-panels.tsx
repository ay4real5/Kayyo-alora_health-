'use client';

import { TIME_OFF_TYPES } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { dayName, humanize } from '@/lib/labels';
import type { AvailabilitySlot, Credential, TimeOff } from '@/lib/types/people';

/** A mutation that refreshes this staff member's data afterwards and resolves true/false (errors shown by caller). */
function useStaffAction(staffId: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown }) =>
      request(path, { method, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
  const run = (path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', body?: unknown) =>
    mutation.mutateAsync({ path: `/staff/${staffId}${path}`, method, body }).then(
      () => true,
      () => false,
    );
  return { run, error: mutation.error, busy: mutation.isPending };
}

export function CredentialsPanel({ staffId, canEdit }: { staffId: string; canEdit: boolean }) {
  const { request } = useAuth();
  const { run, error, busy } = useStaffAction(staffId);
  const list = useQuery({
    queryKey: ['staff', staffId, 'credentials'],
    queryFn: async () => (await request<Credential[]>(`/staff/${staffId}/credentials`)).data,
  });

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const body: Record<string, unknown> = {};
    for (const key of ['credentialType', 'credentialName', 'credentialNumber', 'issuingAuthority', 'issueDate', 'expiryDate']) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = value;
    }
    if (await run('/credentials', 'POST', body)) formEl.reset();
  };

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Credentials</h2>
      <ErrorAlert error={error ?? list.error} />
      <ul className="mb-4 divide-y divide-slate-100 text-sm">
        {list.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{c.credentialName}</span>
              <span className="text-slate-500"> · {humanize(c.credentialType)}</span>
              {c.expiryDate && <span className="text-slate-500"> · expires {formatDate(c.expiryDate)}</span>}
              {c.verifiedAt && <span className="ml-2 text-xs text-emerald-700">verified</span>}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={c.state} />
              {canEdit && !c.verifiedAt && (
                <Button variant="ghost" disabled={busy} onClick={() => void run(`/credentials/${c.id}`, 'PATCH', { verified: true })}>
                  Mark verified
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${c.credentialName}`}
                  onClick={() => window.confirm(`Remove ${c.credentialName}?`) && void run(`/credentials/${c.id}`, 'DELETE')}
                >
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-2 text-slate-500">No credentials recorded.</li>}
      </ul>
      {canEdit && (
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" name="credentialType" placeholder="license, cpr, tb_test…" required />
          <Field label="Name" name="credentialName" placeholder="RN license" required />
          <Field label="Number" name="credentialNumber" />
          <Field label="Issued by" name="issuingAuthority" />
          <Field label="Issue date" name="issueDate" type="date" />
          <Field label="Expiry date" name="expiryDate" type="date" />
          <Button type="submit" variant="secondary" disabled={busy} className="sm:justify-self-start">
            Add credential
          </Button>
        </form>
      )}
    </Card>
  );
}

export function AvailabilityEditor({ staffId, canEdit }: { staffId: string; canEdit: boolean }) {
  const { request } = useAuth();
  const current = useQuery({
    queryKey: ['staff', staffId, 'availability'],
    queryFn: async () => (await request<AvailabilitySlot[]>(`/staff/${staffId}/availability`)).data,
  });
  return (
    <Card className="p-5">
      <h2 className="mb-1 text-base font-semibold text-slate-900">Weekly availability</h2>
      <p className="mb-4 text-xs text-slate-500">Used to warn schedulers about visits outside these hours.</p>
      {current.data && (
        <AvailabilityForm key={JSON.stringify(current.data)} staffId={staffId} saved={current.data} canEdit={canEdit} />
      )}
    </Card>
  );
}

function AvailabilityForm({ staffId, saved, canEdit }: { staffId: string; saved: AvailabilitySlot[]; canEdit: boolean }) {
  const { run, error, busy } = useStaffAction(staffId);
  const [slots, setSlots] = useState(saved);
  const update = (i: number, patch: Partial<AvailabilitySlot>) =>
    setSlots((all) => all.map((slot, n) => (n === i ? { ...slot, ...patch } : slot)));

  return (
    <div className="flex flex-col gap-3">
      <ErrorAlert error={error} />
      {slots.length === 0 && <p className="text-sm text-slate-500">No availability set — any time is assumed.</p>}
      {slots.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-end gap-3">
          <SelectField label="Day" value={slot.dayOfWeek} disabled={!canEdit} onChange={(e) => update(i, { dayOfWeek: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <option key={d} value={d}>
                {dayName(d)}
              </option>
            ))}
          </SelectField>
          <Field label="From" type="time" value={slot.startTime} disabled={!canEdit} onChange={(e) => update(i, { startTime: e.target.value })} />
          <Field label="To" type="time" value={slot.endTime} disabled={!canEdit} onChange={(e) => update(i, { endTime: e.target.value })} />
          {canEdit && (
            <Button variant="ghost" onClick={() => setSlots((all) => all.filter((_, n) => n !== i))}>
              Remove
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setSlots((all) => [...all, { dayOfWeek: 1, startTime: '08:00', endTime: '17:00' }])}
          >
            Add time slot
          </Button>
          <Button disabled={busy} onClick={() => void run('/availability', 'PUT', { slots })}>
            Save availability
          </Button>
        </div>
      )}
    </div>
  );
}

export function TimeOffPanel({
  staffId,
  canRequest,
  canApprove,
  isSelf,
}: {
  staffId: string;
  canRequest: boolean;
  canApprove: boolean;
  isSelf: boolean;
}) {
  const { request } = useAuth();
  const { run, error, busy } = useStaffAction(staffId);
  const list = useQuery({
    queryKey: ['staff', staffId, 'time-off'],
    queryFn: async () => (await request<TimeOff[]>(`/staff/${staffId}/time-off`)).data,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const notes = String(form.get('notes') ?? '').trim();
    const ok = await run('/time-off', 'POST', {
      startDate: form.get('startDate'),
      endDate: form.get('endDate'),
      type: form.get('type'),
      ...(notes ? { notes } : {}),
    });
    if (ok) formEl.reset();
  };

  return (
    <Card className="p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Time off</h2>
      <ErrorAlert error={error ?? list.error} />
      <ul className="mb-4 divide-y divide-slate-100 text-sm">
        {list.data?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {formatDate(t.startDate)} – {formatDate(t.endDate)} · {humanize(t.type)}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={t.status} />
              {t.status === 'pending' && canApprove && !isSelf && (
                <>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(`/time-off/${t.id}`, 'PATCH', { status: 'approved' })}>
                    Approve
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(`/time-off/${t.id}`, 'PATCH', { status: 'denied' })}>
                    Deny
                  </Button>
                </>
              )}
              {t.status === 'pending' && canRequest && (
                <Button variant="ghost" disabled={busy} onClick={() => void run(`/time-off/${t.id}`, 'PATCH', { status: 'cancelled' })}>
                  Cancel request
                </Button>
              )}
            </span>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-2 text-slate-500">No time-off requests.</li>}
      </ul>
      {canRequest && (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
          <Field label="From" name="startDate" type="date" required />
          <Field label="To" name="endDate" type="date" required />
          <SelectField label="Type" name="type" defaultValue="vacation">
            {TIME_OFF_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <Field label="Notes" name="notes" />
          <Button type="submit" variant="secondary" disabled={busy} className="sm:justify-self-start">
            Request time off
          </Button>
        </form>
      )}
    </Card>
  );
}
