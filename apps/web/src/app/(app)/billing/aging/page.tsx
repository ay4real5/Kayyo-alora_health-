'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';

interface Aging {
  asOf: string;
  buckets: string[];
  rows: { id: string; name: string; buckets: number[]; total: number }[];
  totals: number[];
  total: number;
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Accounts receivable aging (D-063): what payers and private-pay families still owe, by age. */
export default function AgingPage() {
  const { request, can } = useAuth();
  const [asOf, setAsOf] = useState('');
  const aging = useQuery({
    queryKey: ['billing', 'aging', asOf],
    enabled: can('billing:read'),
    queryFn: async () => (await request<Aging>(`/billing/reports/aging${asOf ? `?asOf=${asOf}` : ''}`)).data,
  });
  if (!can('billing:read')) return <PageHeader title="AR aging" subtitle="You don't have access to billing." />;
  const a = aging.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AR aging"
        subtitle="Unpaid balances by days since the claim was sent (invoices: since issued). Denied claims count until the denial is final."
      />
      <Card className="flex flex-col gap-4 p-4">
        <Field label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-44" />
        <ErrorAlert error={aging.error} />
        {a && (
          <>
            <p className="text-sm text-slate-600">
              As of {formatDate(a.asOf)}: <strong className="text-slate-900">{money(a.total)}</strong> outstanding.
            </p>
            <table className="w-full text-left text-sm" aria-label="Aging">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Payer</th>
                  {a.buckets.map((b) => (
                    <th key={b} className="py-2 pr-4 text-right font-medium">
                      {b} days
                    </th>
                  ))}
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {a.rows.length === 0 && (
                  <tr>
                    <td colSpan={a.buckets.length + 2} className="py-3 text-slate-500">
                      Nothing outstanding.
                    </td>
                  </tr>
                )}
                {a.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-4">{r.name}</td>
                    {r.buckets.map((v, i) => (
                      <td key={a.buckets[i]} className={`py-2 pr-4 text-right ${i >= 3 && v > 0 ? 'font-medium text-red-700' : ''}`}>
                        {v ? money(v) : '—'}
                      </td>
                    ))}
                    <td className="py-2 text-right font-medium">{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              {a.rows.length > 0 && (
                <tfoot className="border-t border-slate-300 font-semibold">
                  <tr>
                    <td className="py-2 pr-4">Total</td>
                    {a.totals.map((v, i) => (
                      <td key={a.buckets[i]} className="py-2 pr-4 text-right">
                        {money(v)}
                      </td>
                    ))}
                    <td className="py-2 text-right">{money(a.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
