'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { money, type MileageEntry, type PayPeriod } from '@/lib/types/payroll';

const BADGE: Record<string, string> = { open: 'draft', calculated: 'pending', approved: 'approved', exported: 'completed' };

/** Payroll (D-064): pay periods and mileage waiting for approval. */
export default function PayrollPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const periods = useQuery({
    queryKey: ['payroll', 'periods', page],
    enabled: can('payroll:read'),
    placeholderData: keepPreviousData,
    queryFn: () => request<PayPeriod[]>(`/payroll/pay-periods?page=${page}&limit=20`),
  });
  const create = useMutation({
    mutationFn: (body: Record<string, string>) => request('/payroll/pay-periods', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll'] }),
  });
  if (!can('payroll:read')) return <PageHeader title="Payroll" subtitle="You don't have access to payroll." />;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    create.mutate(
      { periodStart: String(f.get('periodStart')), periodEnd: String(f.get('periodEnd')), payDate: String(f.get('payDate')) },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payroll" subtitle="Pay from EVV-verified visits and approved mileage. Taxes are withheld by your payroll provider." />
      {can('payroll:create') && (
        <Card className="flex flex-col gap-3 p-4">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Field label="Period start" name="periodStart" type="date" required />
            <Field label="Period end" name="periodEnd" type="date" required />
            <Field label="Pay date" name="payDate" type="date" required />
            <Button type="submit" disabled={create.isPending}>
              New pay period
            </Button>
          </form>
          <ErrorAlert error={create.error} />
        </Card>
      )}
      <Card className="flex flex-col gap-3 p-4">
        <ErrorAlert error={periods.error} />
        {periods.data?.data.length === 0 && <p className="text-sm text-slate-500">No pay periods yet.</p>}
        <table className="w-full text-left text-sm" aria-label="Pay periods">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Period</th>
              <th className="py-2 pr-4 font-medium">Pay date</th>
              <th className="py-2 pr-4 font-medium">Staff</th>
              <th className="py-2 pr-4 font-medium">Gross</th>
              <th className="py-2 pr-4 font-medium">Mileage</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {periods.data?.data.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-4">
                  <Link href={`/payroll/${p.id}`} className="text-teal-800 hover:underline">
                    {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                  </Link>
                </td>
                <td className="py-2 pr-4">{formatDate(p.payDate)}</td>
                <td className="py-2 pr-4">{p.staffCount}</td>
                <td className="py-2 pr-4">{money(p.totalGross ?? 0)}</td>
                <td className="py-2 pr-4">{money(p.totalMileage ?? 0)}</td>
                <td className="py-2">
                  <StatusBadge status={BADGE[p.status] ?? p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {periods.data?.meta && <Pager page={periods.data.meta.page} limit={periods.data.meta.limit} total={periods.data.meta.total} onPage={setPage} />}
      </Card>
      {can('payroll:approve') && <MileageApprovals />}
    </div>
  );
}

function MileageApprovals() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const pending = useQuery({
    queryKey: ['payroll', 'mileage', 'pending'],
    queryFn: async () => (await request<MileageEntry[]>('/payroll/mileage?status=pending&limit=100')).data,
  });
  const decide = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, string> }) => request(`/payroll/mileage/${id}`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll'] }),
  });
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Mileage to approve</h2>
      <ErrorAlert error={pending.error ?? decide.error} />
      {pending.data?.length === 0 && <p className="text-sm text-slate-500">Nothing waiting.</p>}
      <ul aria-label="Mileage to approve" className="flex flex-col divide-y divide-slate-100 text-sm">
        {pending.data?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              <span className="font-medium">
                {m.staff.firstName} {m.staff.lastName}
              </span>{' '}
              · {formatDate(m.travelDate)} · {m.miles} miles{m.description && ` · ${m.description}`}
            </span>
            <span className="flex gap-3 text-xs">
              <button type="button" className="underline" onClick={() => decide.mutate({ id: m.id, body: { decision: 'approved' } })}>
                Approve
              </button>
              <button
                type="button"
                className="text-slate-500 underline"
                onClick={() => {
                  const reason = window.prompt('Why is this mileage rejected?');
                  if (reason?.trim()) decide.mutate({ id: m.id, body: { decision: 'rejected', reason: reason.trim() } });
                }}
              >
                Reject
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
