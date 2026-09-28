'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { Payer, PayerRate, ServiceCode } from '@/lib/types/billing';

const PAYER_TYPES = [
  'medicaid',
  'medicaid_mco',
  'medicare',
  'commercial',
  'va',
  'private_pay',
  'other',
];
const UNIT_TYPES = ['unit_15min', 'hour', 'visit', 'day'];
const money = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** Payers, service codes and payer rates (DECISIONS D-050). Billing staff maintain them. */
export default function BillingSetupPage() {
  const { can } = useAuth();
  if (!can('billing:read'))
    return <PageHeader title="Billing setup" subtitle="You don't have access to billing." />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Billing setup" subtitle="Who pays, for which services, at what rate." />
      <PayersCard />
      <ServiceCodesCard />
      <RatesCard />
    </div>
  );
}

function PayersCard() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const payers = useQuery({
    queryKey: ['billing', 'payers'],
    queryFn: async () => (await request<Payer[]>('/billing/payers?limit=100')).data,
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request('/billing/payers', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing', 'payers'] }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    create.mutate(
      {
        name: text(f, 'name'),
        payerType: text(f, 'payerType'),
        ...(text(f, 'payerIdCode') ? { payerIdCode: text(f, 'payerIdCode') } : {}),
        ...(text(f, 'state') ? { state: text(f, 'state') } : {}),
        requiresAuthorization: f.get('requiresAuthorization') === 'on',
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Payers</h2>
      <ErrorAlert error={payers.error} />
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 pr-4 font-medium">Payer ID</th>
            <th className="py-2 pr-4 font-medium">Needs authorization</th>
            <th className="py-2 font-medium">Timely filing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payers.data?.map((p) => (
            <tr key={p.id}>
              <td className="py-2 pr-4">{p.name}</td>
              <td className="py-2 pr-4">{humanize(p.payerType)}</td>
              <td className="py-2 pr-4">{p.payerIdCode ?? '—'}</td>
              <td className="py-2 pr-4">{p.requiresAuthorization ? 'Yes' : 'No'}</td>
              <td className="py-2">{p.timelyFilingDays} days</td>
            </tr>
          ))}
        </tbody>
      </table>
      {can('billing:update') && (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"
        >
          <Field label="Payer name" name="name" required className="min-w-56" />
          <SelectField label="Type" name="payerType" defaultValue="medicaid">
            {PAYER_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <Field label="Payer ID" name="payerIdCode" maxLength={50} />
          <Field label="State" name="state" maxLength={2} className="w-20" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiresAuthorization" /> Needs authorization
          </label>
          <Button type="submit" variant="secondary" disabled={create.isPending}>
            Add payer
          </Button>
          <ErrorAlert error={create.error} />
        </form>
      )}
    </Card>
  );
}

function ServiceCodesCard() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const codes = useQuery({
    queryKey: ['billing', 'service-codes'],
    queryFn: async () => (await request<ServiceCode[]>('/billing/service-codes?limit=100')).data,
  });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request('/billing/service-codes', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing', 'service-codes'] }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    create.mutate(
      {
        code: text(f, 'code'),
        codeType: 'hcpcs',
        unitType: text(f, 'unitType'),
        ...(text(f, 'description') ? { description: text(f, 'description') } : {}),
        ...(text(f, 'defaultRate') ? { defaultRate: Number(text(f, 'defaultRate')) } : {}),
        requiresAuth: f.get('requiresAuth') === 'on',
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Service codes</h2>
      <ErrorAlert error={codes.error} />
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Code</th>
            <th className="py-2 pr-4 font-medium">Description</th>
            <th className="py-2 pr-4 font-medium">Unit</th>
            <th className="py-2 pr-4 font-medium">Default rate</th>
            <th className="py-2 font-medium">Needs authorization</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {codes.data?.map((c) => (
            <tr key={c.id}>
              <td className="py-2 pr-4 font-mono">{c.code}</td>
              <td className="py-2 pr-4">{c.description}</td>
              <td className="py-2 pr-4">{humanize(c.unitType)}</td>
              <td className="py-2 pr-4">{money(c.defaultRate)}</td>
              <td className="py-2">{c.requiresAuth ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {can('billing:update') && (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"
        >
          <Field label="Code (HCPCS)" name="code" required className="w-32" />
          <Field label="Description" name="description" className="min-w-56" />
          <SelectField label="Unit" name="unitType" defaultValue="unit_15min">
            {UNIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <Field
            label="Default rate"
            name="defaultRate"
            type="number"
            min={0}
            step={0.01}
            className="w-28"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requiresAuth" /> Needs authorization
          </label>
          <Button type="submit" variant="secondary" disabled={create.isPending}>
            Add code
          </Button>
          <ErrorAlert error={create.error} />
        </form>
      )}
    </Card>
  );
}

function RatesCard() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [payerId, setPayerId] = useState('');
  const payers = useQuery({
    queryKey: ['billing', 'payers'],
    queryFn: async () => (await request<Payer[]>('/billing/payers?limit=100')).data,
  });
  const codes = useQuery({
    queryKey: ['billing', 'service-codes'],
    queryFn: async () => (await request<ServiceCode[]>('/billing/service-codes?limit=100')).data,
  });
  const rates = useQuery({
    queryKey: ['billing', 'rates', payerId],
    enabled: Boolean(payerId),
    queryFn: async () => (await request<PayerRate[]>(`/billing/payers/${payerId}/rates`)).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing', 'rates', payerId] });
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request(`/billing/payers/${payerId}/rates`, { method: 'POST', body }),
    onSuccess: refresh,
  });
  const end = useMutation({
    mutationFn: ({ id, endDate }: { id: string; endDate: string }) =>
      request(`/billing/payer-rates/${id}`, { method: 'PATCH', body: { endDate } }),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    create.mutate(
      {
        serviceCodeId: text(f, 'serviceCodeId'),
        rate: Number(text(f, 'rate')),
        effectiveDate: text(f, 'effectiveDate'),
        ...(text(f, 'modifier1') ? { modifier1: text(f, 'modifier1') } : {}),
      },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Rates</h2>
        <SelectField label="Payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
          <option value="">Choose a payer…</option>
          {payers.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      </div>
      <ErrorAlert error={rates.error ?? end.error} />
      {payerId && (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Code</th>
              <th className="py-2 pr-4 font-medium">Modifier</th>
              <th className="py-2 pr-4 font-medium">Rate</th>
              <th className="py-2 pr-4 font-medium">From</th>
              <th className="py-2 font-medium">To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rates.data?.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-4 font-mono">{r.serviceCode.code}</td>
                <td className="py-2 pr-4">
                  {[r.modifier1, r.modifier2].filter(Boolean).join(' ') || '—'}
                </td>
                <td className="py-2 pr-4">
                  {money(r.rate)} / {humanize(r.serviceCode.unitType)}
                </td>
                <td className="py-2 pr-4">{formatDate(r.effectiveDate)}</td>
                <td className="py-2">
                  {r.endDate ? (
                    formatDate(r.endDate)
                  ) : can('billing:update') ? (
                    <button
                      type="button"
                      className="text-teal-800 underline"
                      onClick={() => {
                        const endDate = window.prompt('Last day of this rate (YYYY-MM-DD)');
                        if (endDate) end.mutate({ id: r.id, endDate });
                      }}
                    >
                      open — end it
                    </button>
                  ) : (
                    'open'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {payerId && can('billing:update') && (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"
        >
          <SelectField label="Service code" name="serviceCodeId" required>
            <option value="">Choose…</option>
            {codes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </SelectField>
          <Field
            label="Rate"
            name="rate"
            type="number"
            min={0}
            step={0.01}
            required
            className="w-28"
          />
          <Field label="From" name="effectiveDate" type="date" required />
          <Field label="Modifier" name="modifier1" maxLength={2} className="w-24" />
          <Button type="submit" variant="secondary" disabled={create.isPending}>
            Add rate
          </Button>
          <ErrorAlert error={create.error} />
        </form>
      )}
    </Card>
  );
}
