'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface Payment {
  id: string;
  status: string;
  payer: { id: string; name: string } | null;
  paymentAmount: number;
  paymentMethod: string | null;
  paymentDate: string | null;
  checkNumber: string | null;
  file: { fileName: string | null } | null;
  details: {
    id: string;
    claimNumber: string;
    claim: { id: string; status: string; patientName: string } | null;
    statusCode: string;
    chargeAmount: number;
    paidAmount: number;
    adjustmentAmount: number;
    patientResponsibility: number;
  }[];
  unmatched: string[];
  createdAt: string;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const CLAIM_RESULT: Record<string, string> = { '1': 'Processed', '2': 'Processed (secondary)', '3': 'Processed (tertiary)', '4': 'Denied', '22': 'Reversal' };

/** Payer remittances (835) and posting them to claims (D-054). */
export default function PaymentsPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const payments = useQuery({
    queryKey: ['billing', 'payments', page],
    enabled: can('billing:read'),
    placeholderData: keepPreviousData,
    queryFn: () => request<Payment[]>(`/billing/payments?page=${page}&limit=25`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 5 * 1024 * 1024) throw new Error('The file is larger than 5 MB');
      return (await request<Payment>('/billing/edi-files/upload-835', { method: 'POST', body: { fileName: file.name, content: await file.text() } })).data;
    },
    onSuccess: async (p) => {
      setOpen(p.id);
      await refresh();
    },
  });
  const post = useMutation({
    mutationFn: (id: string) => request(`/billing/payments/${id}/post`, { method: 'POST' }),
    onSuccess: refresh,
  });

  if (!can('billing:read')) return <PageHeader title="Payments" subtitle="You don't have access to billing." />;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        subtitle="Load a payer's remittance (835), check it, then post it to the claims."
        actions={
          can('billing:create') && (
            <label className="inline-flex cursor-pointer items-center rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
              Load 835 file
              <input type="file" accept=".835,.edi,.txt,.x12" className="sr-only" onChange={onFile} aria-label="835 file" />
            </label>
          )
        }
      />
      <ErrorAlert error={upload.error ?? post.error} />
      <Card className="flex flex-col gap-3 p-4">
        <ErrorAlert error={payments.error} />
        {payments.data?.data.length === 0 && <p className="text-sm text-slate-500">No payments yet.</p>}
        <ul className="divide-y divide-slate-100" aria-label="Payments">
          {payments.data?.data.map((p) => (
            <li key={p.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="text-left font-medium text-brand-800 hover:underline" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {p.payer?.name ?? 'Unknown payer'} · {money(p.paymentAmount)} {p.paymentMethod ? `(${p.paymentMethod})` : ''} ·{' '}
                  {p.paymentDate ? formatDate(p.paymentDate) : 'no date'} · trace {p.checkNumber ?? '—'}
                </button>
                <span className="flex items-center gap-2">
                  <StatusBadge status={p.status === 'posted' ? 'approved' : 'pending'} />
                  {p.status === 'received' && can('billing:update') && (
                    <Button
                      variant="secondary"
                      disabled={post.isPending}
                      onClick={() => window.confirm('Post this payment to its claims? This can be done once.') && post.mutate(p.id)}
                    >
                      Post to claims
                    </Button>
                  )}
                </span>
              </div>
              {p.unmatched.length > 0 && (
                <p className="text-amber-800">Not our claims (not posted): {p.unmatched.join(', ')}</p>
              )}
              {open === p.id && (
                <table className="mt-2 w-full text-left" aria-label="Payment details">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Claim</th>
                      <th className="py-1 pr-3 font-medium">Result</th>
                      <th className="py-1 pr-3 font-medium">Charged</th>
                      <th className="py-1 pr-3 font-medium">Paid</th>
                      <th className="py-1 pr-3 font-medium">Adjusted</th>
                      <th className="py-1 font-medium">Patient owes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {p.details.map((d) => (
                      <tr key={d.id}>
                        <td className="py-1 pr-3 font-mono">
                          {d.claim ? (
                            <Link href={`/billing/claims/${d.claim.id}`} className="text-brand-800 hover:underline">
                              {d.claimNumber}
                            </Link>
                          ) : (
                            d.claimNumber
                          )}
                        </td>
                        <td className="py-1 pr-3">{CLAIM_RESULT[d.statusCode] ?? d.statusCode}</td>
                        <td className="py-1 pr-3">{money(d.chargeAmount)}</td>
                        <td className="py-1 pr-3">{money(d.paidAmount)}</td>
                        <td className="py-1 pr-3">{money(d.adjustmentAmount)}</td>
                        <td className="py-1">{money(d.patientResponsibility)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          ))}
        </ul>
        {payments.data?.meta && (
          <Pager page={payments.data.meta.page} limit={payments.data.meta.limit} total={payments.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
