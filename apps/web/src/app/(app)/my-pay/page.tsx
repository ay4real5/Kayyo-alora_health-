'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { money, type MileageEntry, type PayStub } from '@/lib/types/payroll';
import { useAgencyToday } from '@/lib/use-agency-today';

const PAY_TYPE: Record<string, string> = { hourly: 'Hours', overtime: 'Overtime', per_visit: 'Visit', mileage: 'Mileage' };

/** Staff: approved pay stubs and mileage (D-064). */
export default function MyPayPage() {
  const { request } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const stubs = useQuery({ queryKey: ['payroll', 'mine'], queryFn: async () => (await request<PayStub[]>('/payroll/my-stubs')).data });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My pay" subtitle="Your pay stubs once payroll is approved (before taxes), and your mileage." />
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-base font-semibold text-slate-900">Pay stubs</h2>
        <ErrorAlert error={stubs.error} />
        {stubs.data?.length === 0 && <p className="text-sm text-slate-500">No pay stubs yet.</p>}
        <ul aria-label="Pay stubs" className="flex flex-col divide-y divide-slate-100 text-sm">
          {stubs.data?.map((s) => (
            <li key={s.id} className="py-2">
              <button type="button" className="flex w-full flex-wrap justify-between gap-2 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span>
                  {formatDate(s.payPeriod.periodStart)} – {formatDate(s.payPeriod.periodEnd)} · paid {formatDate(s.payPeriod.payDate)}
                </span>
                <span className="font-medium">
                  {money(s.grossPay)} {s.mileageAmount > 0 && <span className="text-xs text-slate-500">+ {money(s.mileageAmount)} mileage</span>}
                </span>
              </button>
              {open === s.id && (
                <div className="mt-2 flex flex-col gap-1 rounded-md bg-slate-50 p-3 text-xs">
                  <p>
                    {s.visitCount} visits · {s.regularHours.toFixed(2)} hours{s.overtimeHours > 0 && ` + ${s.overtimeHours.toFixed(2)} overtime`}
                    {s.bonusAmount > 0 && ` · bonus ${money(s.bonusAmount)}`}
                    {s.deductions > 0 && ` · deductions ${money(s.deductions)}`}
                  </p>
                  {s.notes && <p>Note: {s.notes}</p>}
                  <table className="mt-1 w-full text-left" aria-label="Pay stub lines">
                    <tbody>
                      {s.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="pr-3">{formatDate(l.serviceDate)}</td>
                          <td className="pr-3">{PAY_TYPE[l.payType]}</td>
                          <td className="pr-3">{l.patientLabel}</td>
                          <td className="pr-3 text-right">{l.hours !== null && l.payType !== 'mileage' ? `${l.hours} h` : ''}</td>
                          <td className="text-right">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <MyMileage />
    </div>
  );
}

function MyMileage() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const today = useAgencyToday();
  const mileage = useQuery({ queryKey: ['payroll', 'my-mileage'], queryFn: async () => (await request<MileageEntry[]>('/payroll/mileage?limit=50')).data });
  const log = useMutation({
    mutationFn: (body: Record<string, unknown>) => request('/payroll/mileage', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll', 'my-mileage'] }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    log.mutate(
      { travelDate: String(f.get('travelDate')), miles: Number(f.get('miles')), description: String(f.get('description') ?? '').trim() || undefined },
      { onSuccess: () => form.reset() },
    );
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Mileage</h2>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Date" name="travelDate" type="date" defaultValue={today} max={today} required />
        <Field label="Miles" name="miles" type="number" min={0.1} step={0.1} required className="w-28" />
        <Field label="Trip" name="description" placeholder="Office to client visit" className="min-w-64 flex-1" />
        <Button type="submit" variant="secondary" disabled={log.isPending}>
          Log mileage
        </Button>
      </form>
      <ErrorAlert error={mileage.error ?? log.error} />
      <ul aria-label="My mileage" className="flex flex-col divide-y divide-slate-100 text-sm">
        {mileage.data?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {formatDate(m.travelDate)} · {m.miles} miles{m.description && ` · ${m.description}`}
              {m.rejectReason && <span className="block text-xs text-red-700">Rejected: {m.rejectReason}</span>}
            </span>
            <StatusBadge status={m.status === 'approved' ? 'approved' : m.status === 'rejected' ? 'denied' : 'pending'} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
