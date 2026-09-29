'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { clockTime, flagLabel } from '@/lib/labels';
import type { EvvRecord } from '@/lib/types/evv';

/** EVV records (DECISIONS D-038/D-042): by default the ones a supervisor needs to look at. */
export default function EvvPage() {
  const { request } = useAuth();
  const [needsReview, setNeedsReview] = useState(true);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const records = useQuery({
    queryKey: ['evv', 'records', { needsReview, status, from, to, page }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (needsReview) params.set('needsReview', 'true');
      if (status) params.set('status', status);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return request<EvvRecord[]>(`/evv/records?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="EVV records" subtitle="Clock-ins and clock-outs from the field, and the ones that need a decision." />
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={(e) => {
                setNeedsReview(e.target.checked);
                setPage(1);
              }}
            />
            Only needing review
          </label>
          <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="exception">Exception</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </SelectField>
          <Field label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Field label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>
        <ErrorAlert error={records.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Caregiver</th>
              <th className="py-2 pr-4 font-medium">Patient</th>
              <th className="py-2 pr-4 font-medium">In / out</th>
              <th className="py-2 pr-4 font-medium">Flags</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.data?.data.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-4">
                  <Link href={`/evv/${r.id}`} className="font-medium text-violet-800 hover:underline">
                    {formatDate(r.serviceDate)}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {r.staff.firstName} {r.staff.lastName} <span className="text-slate-500">({r.staff.discipline})</span>
                </td>
                <td className="py-2 pr-4">
                  {r.patient.lastName}, {r.patient.firstName}
                </td>
                <td className="py-2 pr-4">
                  {clockTime(r.clockIn.time)} – {clockTime(r.clockOut?.time)}
                </td>
                <td className="py-2 pr-4 text-amber-900">
                  {r.flags.map(flagLabel).join('; ')}
                  {r.exceptions.some((e) => e.status === 'pending') && (
                    <span className="ml-1 text-sky-800">Correction waiting</span>
                  )}
                </td>
                <td className="py-2">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.data?.meta && (
          <Pager page={records.data.meta.page} limit={records.data.meta.limit} total={records.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
