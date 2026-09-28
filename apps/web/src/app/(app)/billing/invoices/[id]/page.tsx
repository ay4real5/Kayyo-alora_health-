'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Invoice } from '@/lib/types/billing';
import { useAgencyToday } from '@/lib/use-agency-today';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const METHODS = ['check', 'cash', 'card', 'ach', 'other'];

/** One invoice: lines, PDF, mark sent, record payments, void (D-059). */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const key = ['billing', 'invoices', id];
  const invoice = useQuery({ queryKey: key, queryFn: async () => (await request<Invoice>(`/billing/invoices/${id}`)).data });
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      (await request<Invoice>(`/billing/invoices/${id}/${path}`, { method: 'POST', body: body ?? {} })).data,
    onSuccess: (data) => {
      queryClient.setQueryData(key, data);
      return queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] });
    },
  });
  const pdf = useMutation({
    mutationFn: async () => {
      const file = (await request<Blob>(`/billing/invoices/${id}/pdf`, { responseType: 'blob' })).data;
      const url = URL.createObjectURL(file);
      Object.assign(document.createElement('a'), { href: url, download: `${invoice.data?.invoiceNumber ?? 'invoice'}.pdf` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  const i = invoice.data;
  if (!i) return <ErrorAlert error={invoice.error} />;
  const recordPayment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    act.mutate(
      {
        path: 'record-payment',
        body: {
          amount: Number(f.get('amount')),
          paidOn: String(f.get('paidOn')),
          method: String(f.get('method')),
          reference: String(f.get('reference') ?? '').trim() || undefined,
        },
      },
      { onSuccess: () => form.reset() },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="font-mono">{i.invoiceNumber}</span> <StatusBadge status={i.overdue ? 'overdue' : i.status} />
          </span>
        }
        subtitle={`${i.patient.lastName}, ${i.patient.firstName} · ${formatDate(i.billingPeriodStart)} – ${formatDate(i.billingPeriodEnd)}`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
              Download PDF
            </Button>
            {i.status === 'draft' && can('billing:send') && (
              <Button onClick={() => act.mutate({ path: 'send' })} disabled={act.isPending}>
                Mark as sent
              </Button>
            )}
          </div>
        }
      />
      <ErrorAlert error={act.error ?? pdf.error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <DetailList
            items={[
              ['Bill to', [i.billTo.name, ...i.billTo.addressLines].join(', ')],
              ['Issued', formatDate(i.issueDate)],
              ['Due', formatDate(i.dueDate)],
              ['Sent', i.sentAt ? new Date(i.sentAt).toLocaleString() : 'Not yet'],
              ['Total', money(i.totalAmount)],
              ['Paid', money(i.paidAmount)],
              ['Balance due', <strong key="b">{money(i.balanceDue)}</strong>],
              ...(i.voidReason ? ([['Void reason', i.voidReason]] as [string, string][]) : []),
              ...(i.notes ? ([['Notes', i.notes]] as [string, string][]) : []),
            ]}
          />
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-base font-semibold text-slate-900">Payments</h2>
          {i.payments.length === 0 && <p className="text-sm text-slate-500">No payments recorded.</p>}
          <ul aria-label="Payments" className="flex flex-col gap-1 text-sm">
            {i.payments.map((p) => (
              <li key={p.id}>
                {formatDate(p.paidOn)} · {money(p.amount)} by {p.method}
                {p.reference && ` #${p.reference}`}{' '}
                <span className="text-xs text-slate-500">
                  (recorded by {p.recordedBy.firstName} {p.recordedBy.lastName})
                </span>
              </li>
            ))}
          </ul>
          {['sent', 'partially_paid'].includes(i.status) && can('billing:update') && (
            <form onSubmit={recordPayment} className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <Field label="Amount" name="amount" type="number" step="0.01" min="0.01" max={i.balanceDue} defaultValue={i.balanceDue} required />
              <Field label="Received on" name="paidOn" type="date" defaultValue={today} required />
              <SelectField label="Method" name="method" defaultValue="check">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m === 'ach' ? 'Bank transfer (ACH)' : m[0]!.toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </SelectField>
              <Field label="Reference" name="reference" placeholder="Check #" />
              <div>
                <Button type="submit" variant="secondary" disabled={act.isPending}>
                  Record payment
                </Button>
              </div>
            </form>
          )}
          {i.status === 'draft' && <p className="text-xs text-slate-500">Mark the invoice as sent to record payments.</p>}
          {i.status !== 'void' && i.paidAmount === 0 && can('billing:void') && (
            <button
              type="button"
              className="self-start text-xs text-slate-500 underline"
              onClick={() => {
                const reason = window.prompt('Why is this invoice being voided? Its visits can then be billed again.');
                if (reason?.trim()) act.mutate({ path: 'void', body: { reason } });
              }}
            >
              Void invoice
            </button>
          )}
        </Card>
      </div>
      <Card className="p-5">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Services</h2>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Service</th>
              <th className="py-2 pr-4 font-medium">Qty</th>
              <th className="py-2 pr-4 font-medium">Rate</th>
              <th className="py-2 font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {i.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4">{formatDate(l.serviceDate)}</td>
                <td className="py-2 pr-4">
                  {l.description}
                  {l.serviceCode && <span className="ml-1 font-mono text-xs text-slate-500">{l.serviceCode}</span>}
                </td>
                <td className="py-2 pr-4">{l.quantity}</td>
                <td className="py-2 pr-4">{money(l.unitRate)}</td>
                <td className="py-2">{money(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
