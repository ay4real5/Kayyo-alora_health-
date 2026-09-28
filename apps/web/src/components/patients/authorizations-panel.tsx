'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';
import type { Authorization, Payer, ServiceCode } from '@/lib/types/billing';

function limit(
  authorized: number | null,
  used: number,
  planned: number,
  remaining: number | null,
  unit: string,
) {
  if (authorized === null) return null;
  return (
    <span>
      {used} used + {planned} booked of {authorized} {unit} ·{' '}
      <strong className={remaining !== null && remaining < 0 ? 'text-red-700' : ''}>
        {remaining} left
      </strong>
    </span>
  );
}

/**
 * A patient's payer authorizations (D-050): what's authorized, used (done), booked, and left — computed from the
 * visits linked to each one. Office and billing staff add and cancel them.
 */
export function AuthorizationsPanel({ patientId }: { patientId: string }) {
  const { request, can } = useAuth();
  const today = useAgencyToday();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const key = ['patients', patientId, 'authorizations'];

  const auths = useQuery({
    queryKey: key,
    enabled: can('authorizations:read'),
    queryFn: async () =>
      (await request<Authorization[]>(`/patients/${patientId}/authorizations`)).data,
  });
  const payers = useQuery({
    queryKey: ['billing', 'payers'],
    enabled: adding,
    queryFn: async () => (await request<Payer[]>('/billing/payers?limit=100')).data,
  });
  const codes = useQuery({
    queryKey: ['billing', 'service-codes'],
    enabled: adding,
    queryFn: async () => (await request<ServiceCode[]>('/billing/service-codes?limit=100')).data,
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(`/patients/${patientId}/authorizations`, { method: 'POST', body }),
    onSuccess: async () => {
      setAdding(false);
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      request(`/patients/${patientId}/authorizations/${id}`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  if (!can('authorizations:read')) return null;
  const manage = can('authorizations:manage');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const text = (k: string) => String(f.get(k) ?? '').trim();
    create.mutate({
      payerId: text('payerId'),
      ...(text('authorizationNumber') ? { authorizationNumber: text('authorizationNumber') } : {}),
      ...(text('serviceCode') ? { serviceCode: text('serviceCode') } : {}),
      startDate: text('startDate'),
      endDate: text('endDate'),
      ...(text('authorizedVisits') ? { authorizedVisits: Number(text('authorizedVisits')) } : {}),
      ...(text('authorizedHours') ? { authorizedHours: Number(text('authorizedHours')) } : {}),
    });
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Authorizations</h2>
        {manage && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add authorization
          </Button>
        )}
      </div>
      <ErrorAlert error={auths.error ?? cancel.error} />
      {auths.data?.length === 0 && (
        <p className="text-sm text-slate-500">No authorizations on file.</p>
      )}
      <ul className="flex flex-col gap-3 text-sm" aria-label="Authorizations">
        {auths.data?.map((a) => (
          <li key={a.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">
                {a.payer.name} · {a.serviceCode ?? 'any service'}
                {a.authorizationNumber ? ` · #${a.authorizationNumber}` : ''}
              </span>
              <span className="flex items-center gap-2">
                {a.expiringSoon && <span className="text-amber-800">ends soon</span>}
                <StatusBadge
                  status={
                    a.state === 'exhausted'
                      ? 'expired'
                      : a.state === 'upcoming'
                        ? 'pending'
                        : a.state
                  }
                />
                {a.state === 'exhausted' && <span className="text-red-700">used up</span>}
              </span>
            </div>
            <p className="text-slate-600">
              {formatDate(a.startDate)} – {formatDate(a.endDate)}
            </p>
            <p className="text-slate-700">
              {limit(
                a.authorizedVisits,
                a.used.visits,
                a.planned.visits,
                a.remaining.visits,
                'visits',
              )}
              {a.authorizedVisits !== null && a.authorizedHours !== null ? ' · ' : ''}
              {limit(a.authorizedHours, a.used.hours, a.planned.hours, a.remaining.hours, 'hours')}
            </p>
            {a.notes && <p className="text-slate-500">{a.notes}</p>}
            {manage && a.status === 'active' && (
              <button
                type="button"
                className="mt-1 text-xs text-slate-600 underline"
                onClick={() =>
                  window.confirm(
                    'Cancel this authorization? Booked visits stop counting against it.',
                  ) && cancel.mutate(a.id)
                }
              >
                Cancel authorization
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <form
          onSubmit={submit}
          className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"
        >
          <SelectField label="Payer" name="payerId" required>
            <option value="">Choose…</option>
            {payers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Service code" name="serviceCode">
            <option value="">Any service</option>
            {codes.data?.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.description ?? c.unitType}
              </option>
            ))}
          </SelectField>
          <Field label="Authorization number" name="authorizationNumber" maxLength={50} />
          <div />
          <Field label="Start" name="startDate" type="date" defaultValue={today} required />
          <Field label="End" name="endDate" type="date" required />
          <Field label="Authorized visits" name="authorizedVisits" type="number" min={1} />
          <Field
            label="Authorized hours"
            name="authorizedHours"
            type="number"
            min={0.25}
            step={0.25}
          />
          <p className="text-xs text-slate-500 sm:col-span-2">Enter visits, hours, or both.</p>
          <div className="sm:col-span-2">
            <ErrorAlert error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              Save authorization
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Close
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
