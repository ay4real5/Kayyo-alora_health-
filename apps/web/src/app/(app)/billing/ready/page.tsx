'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { Payer } from '@/lib/types/billing';

interface Check {
  code: string;
  ok: boolean;
  severity: 'error' | 'warning';
  message: string;
}

interface BillableVisit {
  visitId: string;
  serviceDate: string;
  serviceCode: string | null;
  patient: { id: string; firstName: string; lastName: string; mrn: string | null };
  staff: { firstName: string; lastName: string } | null;
  payer: { name: string } | null;
  minutes: number;
  ready: boolean;
  units: number | null;
  rate: number | null;
  amount: number | null;
  checks: Check[];
}

interface Readiness {
  summary: {
    visits: number;
    ready: number;
    blocked: number;
    readyAmount: number;
    blockers: Record<string, number>;
  };
  visits: BillableVisit[];
  meta: { page: number; limit: number; total: number };
}

const money = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Pre-billing QA (D-051): completed visits, what's ready to bill, and exactly what blocks the rest. */
export default function ReadyToBillPage() {
  const { request, can } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [payerId, setPayerId] = useState('');
  const [show, setShow] = useState<'all' | 'true' | 'false'>('all');
  const [page, setPage] = useState(1);

  const payers = useQuery({
    queryKey: ['billing', 'payers'],
    enabled: can('billing:read'),
    queryFn: async () => (await request<Payer[]>('/billing/payers?limit=100')).data,
  });
  const readiness = useQuery({
    queryKey: ['billing', 'ready', { from, to, payerId, show, page }],
    enabled: can('billing:read'),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (payerId) params.set('payerId', payerId);
      if (show !== 'all') params.set('readyOnly', show);
      return (await request<Readiness>(`/billing/ready-to-bill?${params}`)).data;
    },
  });

  const queryClient = useQueryClient();
  const bill = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const end = to || today;
      const start = from || new Date(Date.parse(end) - 30 * 86_400_000).toISOString().slice(0, 10);
      return (
        await request<{ created: { id: string }[]; skipped: unknown[] }>('/billing/claims', {
          method: 'POST',
          body: { from: start, to: end, ...(payerId ? { payerId } : {}) },
        })
      ).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  });

  if (!can('billing:read'))
    return <PageHeader title="Ready to bill" subtitle="You don't have access to billing." />;
  const data = readiness.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ready to bill"
        subtitle="Completed visits checked against everything a claim needs."
        actions={
          can('billing:create') &&
          (data?.summary.ready ?? 0) > 0 && (
            <Button onClick={() => bill.mutate()} disabled={bill.isPending}>
              Create claims for ready visits
            </Button>
          )
        }
      />
      <ErrorAlert error={bill.error} />
      {bill.data && (
        <p role="status" className="text-sm text-teal-800">
          Created {bill.data.created.length} claim{bill.data.created.length === 1 ? '' : 's'}.{' '}
          <Link href="/billing/claims" className="underline">
            See claims
          </Link>
        </p>
      )}
      {data && (
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-xs text-slate-500">Completed visits</p>
            <p className="text-2xl font-semibold">{data.summary.visits}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-slate-500">Ready</p>
            <p className="text-2xl font-semibold text-teal-700">{data.summary.ready}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-slate-500">Blocked</p>
            <p className="text-2xl font-semibold text-red-700">{data.summary.blocked}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-slate-500">Ready to bill</p>
            <p className="text-2xl font-semibold">{money(data.summary.readyAmount)}</p>
          </Card>
        </section>
      )}
      {data && Object.keys(data.summary.blockers).length > 0 && (
        <p className="text-sm text-slate-700">
          Most common blockers:{' '}
          {Object.entries(data.summary.blockers)
            .sort((a, b) => b[1] - a[1])
            .map(([code, n]) => `${humanize(code)} (${n})`)
            .join(' · ')}
        </p>
      )}
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="From"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <Field
            label="To"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          <SelectField
            label="Payer"
            value={payerId}
            onChange={(e) => {
              setPayerId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All payers</option>
            {payers.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Show"
            value={show}
            onChange={(e) => {
              setShow(e.target.value as 'all' | 'true' | 'false');
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="true">Ready only</option>
            <option value="false">Blocked only</option>
          </SelectField>
        </div>
        <ErrorAlert error={readiness.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Patient</th>
              <th className="py-2 pr-4 font-medium">Service</th>
              <th className="py-2 pr-4 font-medium">Units × rate</th>
              <th className="py-2 pr-4 font-medium">Amount</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data?.visits.map((v) => {
              const problems = v.checks.filter((c) => !c.ok);
              return (
                <tr key={v.visitId} className="align-top">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/schedule/visits/${v.visitId}`}
                      className="text-teal-800 hover:underline"
                    >
                      {formatDate(v.serviceDate)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">
                    {v.patient.lastName}, {v.patient.firstName}
                    <span className="block text-xs text-slate-500">
                      {v.payer?.name ?? 'No payer'}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {v.serviceCode ?? '—'}
                    <span className="block text-xs text-slate-500">{v.minutes} min</span>
                  </td>
                  <td className="py-2 pr-4">
                    {v.units !== null ? `${v.units} × ${money(v.rate)}` : '—'}
                  </td>
                  <td className="py-2 pr-4">{money(v.amount)}</td>
                  <td className="py-2">
                    {v.ready ? (
                      <span className="font-medium text-teal-800">Ready</span>
                    ) : (
                      <span className="font-medium text-red-700">Blocked</span>
                    )}
                    {problems.length > 0 && (
                      <ul className="mt-1 list-disc pl-4 text-xs" aria-label="Problems">
                        {problems.map((c) => (
                          <li
                            key={`${c.code}-${c.message}`}
                            className={c.severity === 'error' ? 'text-red-800' : 'text-amber-800'}
                          >
                            {c.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && (
          <Pager
            page={data.meta.page}
            limit={data.meta.limit}
            total={data.meta.total}
            onPage={setPage}
          />
        )}
      </Card>
    </div>
  );
}
