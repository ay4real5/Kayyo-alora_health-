'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Claim } from '@/lib/types/billing';

const STATUSES = ['draft', 'ready', 'submitted', 'acknowledged', 'rejected', 'paid', 'partially_paid', 'denied', 'void'];
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Claims (D-052): made from ready visits on the Ready to bill page. */
export default function ClaimsPage() {
  const { request, can } = useAuth();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const claims = useQuery({
    queryKey: ['billing', 'claims', { status, page }],
    enabled: can('billing:read'),
    placeholderData: keepPreviousData,
    queryFn: () => request<Claim[]>(`/billing/claims?${new URLSearchParams({ page: String(page), limit: '25', ...(status ? { status } : {}) })}`),
  });
  if (!can('billing:read')) return <PageHeader title="Claims" subtitle="You don't have access to billing." />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Claims" subtitle="Create new ones from the Ready to bill page." />
      <Card className="flex flex-col gap-4 p-4">
        <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-48">
          <option value="">Any</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </SelectField>
        <ErrorAlert error={claims.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Claim</th>
              <th className="py-2 pr-4 font-medium">Patient</th>
              <th className="py-2 pr-4 font-medium">Payer</th>
              <th className="py-2 pr-4 font-medium">Period</th>
              <th className="py-2 pr-4 font-medium">Charges</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {claims.data?.data.map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-4">
                  <Link href={`/billing/claims/${c.id}`} className="font-mono text-violet-800 hover:underline">
                    {c.claimNumber}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {c.patient.lastName}, {c.patient.firstName}
                </td>
                <td className="py-2 pr-4">{c.payer.name}</td>
                <td className="py-2 pr-4">
                  {formatDate(c.billingPeriodStart)} – {formatDate(c.billingPeriodEnd)}
                </td>
                <td className="py-2 pr-4">{money(c.totalCharges)}</td>
                <td className="py-2">
                  <StatusBadge status={c.status === 'void' ? 'cancelled' : c.status === 'ready' ? 'approved' : c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {claims.data?.meta && (
          <Pager page={claims.data.meta.page} limit={claims.data.meta.limit} total={claims.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
