'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';

type Person = { id: string; firstName: string; lastName: string } | null;

interface Medication {
  id: string;
  drugName: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  discontinuedReason: string | null;
}
interface Order {
  id: string;
  orderType: string;
  description: string;
  status: string;
  orderedDate: string;
  signedDate: string | null;
  overdue: boolean;
  physician: Person;
}
interface CarePlan {
  id: string;
  version: number;
  status: string;
  certificationPeriodStart: string;
  certificationPeriodEnd: string;
  goals: string[];
  visitFrequency: { discipline: string; frequency: string }[];
  physician: Person;
  physicianSignatureDate: string | null;
}
interface Assessment {
  id: string;
  type: string;
  status: string;
  score: number | null;
  risk: string | null;
  assessor: Person;
  createdAt: string;
}

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

function usePatientList<T>(patientId: string, path: string) {
  const { request } = useAuth();
  return useQuery({
    queryKey: ['patients', patientId, path],
    queryFn: async () => (await request<T[]>(`/patients/${patientId}${path}`)).data,
  });
}

function useAct(patientId: string) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = 'POST',
      body,
    }: {
      path: string;
      method?: 'POST' | 'PATCH';
      body?: unknown;
    }) => request(`/patients/${patientId}${path}`, { method, body: body ?? {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['patients', patientId] }),
  });
}

/** Clinical records on the patient page (D-055): medications, orders, plans of care, assessments. */
export function ClinicalPanels({ patientId }: { patientId: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <MedicationsPanel patientId={patientId} />
      <OrdersPanel patientId={patientId} />
      <CarePlansPanel patientId={patientId} />
      <AssessmentsPanel patientId={patientId} />
    </div>
  );
}

function MedicationsPanel({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const [showAll, setShowAll] = useState(false);
  const meds = usePatientList<Medication>(
    patientId,
    `/medications${showAll ? '?includeInactive=true' : ''}`,
  );
  const act = useAct(patientId);
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    act.mutate(
      {
        path: '/medications',
        body: {
          drugName: text(f, 'drugName'),
          dosage: text(f, 'dosage') || undefined,
          frequency: text(f, 'frequency') || undefined,
          route: text(f, 'route') || undefined,
        },
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Medications</h2>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{' '}
          Show discontinued
        </label>
      </div>
      <ErrorAlert error={meds.error ?? act.error} />
      {meds.data?.length === 0 && <p className="text-sm text-slate-500">None on file.</p>}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Medications">
        {meds.data?.map((m) => (
          <li
            key={m.id}
            className={`flex items-start justify-between gap-2 ${m.isActive ? '' : 'text-slate-500'}`}
          >
            <span>
              <span className={`font-medium ${m.isActive ? 'text-slate-900' : 'line-through'}`}>
                {m.drugName}
              </span>{' '}
              {[m.dosage, m.route, m.frequency].filter(Boolean).join(' · ')}
              {!m.isActive && (
                <span className="block text-xs">
                  Stopped {formatDate(m.endDate)}: {m.discontinuedReason}
                </span>
              )}
            </span>
            {m.isActive && can('medications:manage') && (
              <button
                type="button"
                className="shrink-0 text-xs text-slate-600 underline"
                onClick={() => {
                  const reason = window.prompt(`Why is ${m.drugName} being stopped?`);
                  if (reason)
                    act.mutate({ path: `/medications/${m.id}/discontinue`, body: { reason } });
                }}
              >
                Discontinue
              </button>
            )}
          </li>
        ))}
      </ul>
      {can('medications:manage') && (
        <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
          <Field label="Medication" name="drugName" required className="col-span-2" />
          <Field label="Dose" name="dosage" placeholder="500 mg" />
          <Field label="Route" name="route" placeholder="oral" />
          <Field
            label="How often"
            name="frequency"
            placeholder="twice daily"
            className="col-span-2"
          />
          <div>
            <Button type="submit" variant="secondary" disabled={act.isPending}>
              Add medication
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function OrdersPanel({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const orders = usePatientList<Order>(patientId, '/orders');
  const act = useAct(patientId);
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    act.mutate(
      {
        path: '/orders',
        body: { orderType: text(f, 'orderType'), description: text(f, 'description') },
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-slate-900">Physician orders</h2>
      <ErrorAlert error={orders.error ?? act.error} />
      {orders.data?.length === 0 && <p className="text-sm text-slate-500">No orders.</p>}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Physician orders">
        {orders.data?.map((o) => (
          <li key={o.id} className="rounded-md border border-slate-200 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {humanize(o.orderType)} · {formatDate(o.orderedDate)}
              </span>
              <span className="flex items-center gap-2">
                {o.overdue && (
                  <span className="text-xs font-medium text-red-700">not signed after 30 days</span>
                )}
                <StatusBadge
                  status={
                    o.status === 'signed'
                      ? 'approved'
                      : o.status === 'cancelled'
                        ? 'cancelled'
                        : 'pending'
                  }
                />
              </span>
            </div>
            <p className="text-slate-700">{o.description}</p>
            {can('orders:update') && (o.status === 'pending' || o.status === 'sent') && (
              <div className="mt-1 flex gap-3 text-xs">
                {o.status === 'pending' && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      act.mutate({ path: `/orders/${o.id}/status`, body: { status: 'sent' } })
                    }
                  >
                    Mark sent to physician
                  </button>
                )}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    act.mutate({ path: `/orders/${o.id}/status`, body: { status: 'signed' } })
                  }
                >
                  Mark signed
                </button>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={() =>
                    act.mutate({ path: `/orders/${o.id}/status`, body: { status: 'cancelled' } })
                  }
                >
                  Cancel
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {can('orders:create') && (
        <form onSubmit={add} className="flex flex-col gap-2 border-t border-slate-100 pt-3">
          <SelectField label="Order type" name="orderType" defaultValue="verbal">
            {['verbal', 'plan_of_care', 'medication', 'visit_frequency', 'other'].map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <TextAreaField label="Order" name="description" required />
          <div>
            <Button type="submit" variant="secondary" disabled={act.isPending}>
              Record order
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function CarePlansPanel({ patientId }: { patientId: string }) {
  const { can, request } = useAuth();
  const plans = usePatientList<CarePlan>(patientId, '/care-plans');
  const act = useAct(patientId);
  const [adding, setAdding] = useState(false);
  const physicians = useQuery({
    queryKey: ['physicians', 'options'],
    enabled: adding && can('physicians:read'),
    queryFn: async () =>
      (
        await request<{ id: string; firstName: string; lastName: string }[]>(
          '/physicians?limit=100',
        )
      ).data,
  });
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const freq = text(f, 'frequency')
      .split(',')
      .map((part) => part.trim().split(/\s+/))
      .filter((p) => p.length === 2)
      .map(([discipline, frequency]) => ({
        discipline: discipline!.toUpperCase(),
        frequency: frequency!,
      }));
    act.mutate(
      {
        path: '/care-plans',
        body: {
          ...(text(f, 'physicianId') ? { physicianId: text(f, 'physicianId') } : {}),
          certificationPeriodStart: text(f, 'start'),
          certificationPeriodEnd: text(f, 'end'),
          goals: text(f, 'goals')
            .split('\n')
            .map((g) => g.trim())
            .filter(Boolean),
          visitFrequency: freq,
        },
      },
      { onSuccess: () => setAdding(false) },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Plan of care</h2>
        {can('care_plans:create') && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            New version
          </Button>
        )}
      </div>
      <ErrorAlert error={plans.error ?? act.error} />
      {plans.data?.length === 0 && <p className="text-sm text-slate-500">No plan of care yet.</p>}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Plans of care">
        {plans.data?.map((p) => (
          <li
            key={p.id}
            className={`rounded-md border p-2 ${p.status === 'active' ? 'border-teal-300' : 'border-slate-200 text-slate-500'}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">
                Version {p.version} · {formatDate(p.certificationPeriodStart)} –{' '}
                {formatDate(p.certificationPeriodEnd)}
              </span>
              <StatusBadge
                status={
                  p.status === 'active' ? 'active' : p.status === 'draft' ? 'draft' : 'inactive'
                }
              />
            </div>
            {p.goals.length > 0 && <p>Goals: {p.goals.join('; ')}</p>}
            {p.visitFrequency.length > 0 && (
              <p>
                Frequency:{' '}
                {p.visitFrequency.map((v) => `${v.discipline} ${v.frequency}`).join(', ')}
              </p>
            )}
            {p.status === 'draft' && can('care_plans:update') && (
              <button
                type="button"
                className="mt-1 text-xs text-teal-800 underline"
                onClick={() => {
                  const date = window.prompt('Date the physician signed it (YYYY-MM-DD)');
                  if (date)
                    act.mutate({
                      path: `/care-plans/${p.id}/activate`,
                      body: { physicianSignatureDate: date },
                    });
                }}
              >
                Physician signed — make active
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form onSubmit={add} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
          <SelectField label="Physician" name="physicianId" className="col-span-2">
            <option value="">Choose…</option>
            {physicians.data?.map((d) => (
              <option key={d.id} value={d.id}>
                Dr. {d.firstName} {d.lastName}
              </option>
            ))}
          </SelectField>
          <Field label="Certification from" name="start" type="date" required />
          <Field label="to" name="end" type="date" required />
          <TextAreaField label="Goals (one per line)" name="goals" className="col-span-2" />
          <Field
            label="Visit frequency"
            name="frequency"
            placeholder="HHA 3W8, RN 1W8"
            className="col-span-2"
          />
          <div className="col-span-2 flex gap-2">
            <Button type="submit" disabled={act.isPending}>
              Save draft
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

function AssessmentsPanel({ patientId }: { patientId: string }) {
  const { can, user } = useAuth();
  const assessments = usePatientList<Assessment>(patientId, '/assessments');
  const act = useAct(patientId);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-slate-900">Assessments</h2>
      <ErrorAlert error={assessments.error ?? act.error} />
      {assessments.data?.length === 0 && (
        <p className="text-sm text-slate-500">None yet (clinicians record them in the app).</p>
      )}
      <ul className="flex flex-col gap-2 text-sm" aria-label="Assessments">
        {assessments.data?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {humanize(a.type)} · {new Date(a.createdAt).toLocaleDateString()}
              {a.score !== null && (
                <span className="ml-1 font-medium">
                  score {a.score} ({humanize(a.risk ?? '')} risk)
                </span>
              )}
              {a.assessor && (
                <span className="block text-xs text-slate-500">
                  by {a.assessor.firstName} {a.assessor.lastName}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge
                status={
                  a.status === 'approved'
                    ? 'approved'
                    : a.status === 'completed'
                      ? 'pending'
                      : 'draft'
                }
              />
              {a.status === 'completed' &&
                can('assessments:approve') &&
                a.assessor?.id !== user?.id && (
                  <button
                    type="button"
                    className="text-xs underline"
                    onClick={() => act.mutate({ path: `/assessments/${a.id}/approve` })}
                  >
                    Approve
                  </button>
                )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
