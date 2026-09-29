'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { money, type PayPeriod, type PayStub } from '@/lib/types/payroll';

type Detail = PayPeriod & { stubs: PayStub[] };
type Warning = { staffId: string; staffName: string; message: string };

/** One pay period: calculate, adjust, approve, export (D-064). */
export default function PayPeriodPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [warnings, setWarnings] = useState<Warning[] | null>(null);
  const key = ['payroll', 'period', id];
  const period = useQuery({ queryKey: key, queryFn: async () => (await request<Detail>(`/payroll/pay-periods/${id}`)).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['payroll'] });
  const calculate = useMutation({
    mutationFn: async () => (await request<Detail & { warnings: Warning[] }>(`/payroll/pay-periods/${id}/calculate`, { method: 'POST' })).data,
    onSuccess: (data) => {
      setWarnings(data.warnings);
      return refresh();
    },
  });
  const approve = useMutation({ mutationFn: () => request(`/payroll/pay-periods/${id}/approve`, { method: 'POST' }), onSuccess: refresh });
  const exportCsv = useMutation({
    mutationFn: async () => (await request<{ fileName: string; content: string }>(`/payroll/pay-periods/${id}/export`, { method: 'POST' })).data,
    onSuccess: (file) => {
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv' }));
      Object.assign(document.createElement('a'), { href: url, download: file.fileName }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return refresh();
    },
  });
  const adjust = useMutation({
    mutationFn: ({ stubId, body }: { stubId: string; body: Record<string, number> }) => request(`/payroll/pay-stubs/${stubId}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  });

  const p = period.data;
  if (!p) return <ErrorAlert error={period.error} />;
  const editable = p.status === 'calculated' && can('payroll:update');
  const total = (k: keyof PayStub) => p.stubs.reduce((s, x) => s + (x[k] as number), 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Pay period {formatDate(p.periodStart)} – {formatDate(p.periodEnd)} <StatusBadge status={p.status === 'exported' ? 'completed' : p.status === 'approved' ? 'approved' : p.status === 'calculated' ? 'pending' : 'draft'} />
          </span>
        }
        subtitle={`Pay date ${formatDate(p.payDate)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(p.status === 'open' || p.status === 'calculated') && can('payroll:create') && (
              <Button variant="secondary" onClick={() => calculate.mutate()} disabled={calculate.isPending}>
                {p.status === 'open' ? 'Calculate' : 'Recalculate'}
              </Button>
            )}
            {p.status === 'calculated' && can('payroll:approve') && (
              <Button onClick={() => window.confirm('Approve this payroll? Stubs are locked and staff are notified.') && approve.mutate()} disabled={approve.isPending}>
                Approve
              </Button>
            )}
            {(p.status === 'approved' || p.status === 'exported') && can('payroll:export') && (
              <Button variant="secondary" onClick={() => exportCsv.mutate()} disabled={exportCsv.isPending}>
                Download CSV
              </Button>
            )}
          </div>
        }
      />
      <ErrorAlert error={calculate.error ?? approve.error ?? exportCsv.error ?? adjust.error} />
      {warnings && warnings.length > 0 && (
        <Alert tone="warning">
          <p className="font-medium">Not everything could be paid:</p>
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.staffId + w.message}>
                {w.staffName}: {w.message}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Card className="overflow-x-auto p-4">
        {p.stubs.length === 0 && <p className="text-sm text-slate-500">{p.status === 'open' ? 'Calculate to see pay.' : 'Nobody to pay in this period.'}</p>}
        {p.stubs.length > 0 && (
          <table className="w-full text-left text-sm" aria-label="Pay stubs">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-2 pr-3 font-medium">Staff</th>
                <th className="py-2 pr-3 text-right font-medium">Visits</th>
                <th className="py-2 pr-3 text-right font-medium">Hours</th>
                <th className="py-2 pr-3 text-right font-medium">Overtime</th>
                <th className="py-2 pr-3 text-right font-medium">Earnings</th>
                <th className="py-2 pr-3 text-right font-medium">Bonus</th>
                <th className="py-2 pr-3 text-right font-medium">Deductions</th>
                <th className="py-2 pr-3 text-right font-medium">Gross</th>
                <th className="py-2 text-right font-medium">Mileage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {p.stubs.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-3">
                    {s.staff.lastName}, {s.staff.firstName} <span className="text-xs text-slate-500">{s.staff.discipline}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">{s.visitCount}</td>
                  <td className="py-2 pr-3 text-right">{s.regularHours.toFixed(2)}</td>
                  <td className={`py-2 pr-3 text-right ${s.overtimeHours ? 'font-medium text-amber-800' : ''}`}>{s.overtimeHours.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right">{money(s.regularPay + s.overtimePay + s.perVisitPay)}</td>
                  {(['bonusAmount', 'deductions'] as const).map((k) => (
                    <td key={k} className="py-2 pr-3 text-right">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          defaultValue={s[k]}
                          aria-label={`${k === 'bonusAmount' ? 'Bonus' : 'Deductions'} for ${s.staff.firstName} ${s.staff.lastName}`}
                          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right"
                          onBlur={(e) => {
                            const value = Number(e.target.value || 0);
                            if (value !== s[k]) adjust.mutate({ stubId: s.id, body: { [k]: value } });
                          }}
                        />
                      ) : (
                        money(s[k])
                      )}
                    </td>
                  ))}
                  <td className="py-2 pr-3 text-right font-medium">{money(s.grossPay)}</td>
                  <td className="py-2 text-right">{s.mileageAmount ? money(s.mileageAmount) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-300 font-semibold">
              <tr>
                <td className="py-2 pr-3">Total</td>
                <td className="py-2 pr-3 text-right">{total('visitCount')}</td>
                <td className="py-2 pr-3 text-right">{total('regularHours').toFixed(2)}</td>
                <td className="py-2 pr-3 text-right">{total('overtimeHours').toFixed(2)}</td>
                <td className="py-2 pr-3 text-right">{money(total('regularPay') + total('overtimePay') + total('perVisitPay'))}</td>
                <td className="py-2 pr-3 text-right">{money(total('bonusAmount'))}</td>
                <td className="py-2 pr-3 text-right">{money(total('deductions'))}</td>
                <td className="py-2 pr-3 text-right">{money(total('grossPay'))}</td>
                <td className="py-2 text-right">{money(total('mileageAmount'))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
    </div>
  );
}
