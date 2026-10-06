'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Invoice } from '@/lib/types/billing';
import { useAgencyToday } from '@/lib/use-agency-today';

const STATUSES = ['draft', 'sent', 'partially_paid', 'paid', 'void'];
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** First and last day of the previous month, e.g. for "invoice last month". */
function lastMonth(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y!, m! - 2, 1));
  const end = new Date(Date.UTC(y!, m! - 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Private-pay invoices (D-059): generate for a period, then send, collect and track. */
export default function InvoicesPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const invoices = useQuery({
    queryKey: ['billing', 'invoices', { status, page }],
    enabled: can('billing:read'),
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<Invoice[]>(`/billing/invoices?${new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}) })}`),
  });
  const generate = useMutation({
    mutationFn: async (body: { from: string; to: string }) =>
      (await request<{ created: Invoice[]; skipped: { visitId: string; reasons: string[] }[] }>('/billing/invoices', { method: 'POST', body })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
  });

  if (!can('billing:read')) return <PageHeader title="Invoices" subtitle="You don't have access to billing." />;
  const period = lastMonth(today);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    generate.mutate({ from: String(f.get('from')), to: String(f.get('to')) });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" subtitle="Bills for private-pay patients. Insurance and Medicaid go on claims." />
      {can('billing:create') && (
        <Card className="flex flex-col gap-3 p-4">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <Field label="Visits from" name="from" type="date" defaultValue={period.from} required />
            <Field label="to" name="to" type="date" defaultValue={period.to} required />
            <Button type="submit" disabled={generate.isPending}>
              {generate.isPending ? 'Creating…' : 'Create invoices'}
            </Button>
          </form>
          <p className="text-xs text-slate-500">
            One invoice per private-pay patient for completed, verified visits in the period that aren&apos;t billed yet.
          </p>
          <ErrorAlert error={generate.error} />
          {generate.data && (
            <Alert tone="info">
              Created {generate.data.created.length} invoice{generate.data.created.length === 1 ? '' : 's'}.
              {generate.data.skipped.length > 0 && (
                <> {generate.data.skipped.length} visit(s) weren&apos;t ready — see Ready to bill for the reasons.</>
              )}
            </Alert>
          )}
        </Card>
      )}
      <Card className="flex flex-col gap-4 p-4">
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-48"
        >
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </SelectField>
        <ErrorAlert error={invoices.error} />
        {invoices.data?.data.length === 0 && <p className="text-sm text-slate-500">No invoices.</p>}
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Invoice</th>
              <th className="py-2 pr-4 font-medium">Patient</th>
              <th className="py-2 pr-4 font-medium">Period</th>
              <th className="py-2 pr-4 font-medium">Due</th>
              <th className="py-2 pr-4 font-medium">Total</th>
              <th className="py-2 pr-4 font-medium">Balance</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.data?.data.map((i) => (
              <tr key={i.id}>
                <td className="py-2 pr-4">
                  <Link href={`/billing/invoices/${i.id}`} className="font-mono text-brand-800 hover:underline">
                    {i.invoiceNumber}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {i.patient.lastName}, {i.patient.firstName}
                </td>
                <td className="py-2 pr-4">
                  {formatDate(i.billingPeriodStart)} – {formatDate(i.billingPeriodEnd)}
                </td>
                <td className="py-2 pr-4">{formatDate(i.dueDate)}</td>
                <td className="py-2 pr-4">{money(i.totalAmount)}</td>
                <td className="py-2 pr-4">{money(i.balanceDue)}</td>
                <td className="py-2">
                  <StatusBadge status={i.overdue ? 'overdue' : i.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.data?.meta && (
          <Pager page={invoices.data.meta.page} limit={invoices.data.meta.limit} total={invoices.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
