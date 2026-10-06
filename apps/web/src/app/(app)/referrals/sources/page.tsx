'use client';

import { REFERRAL_SOURCE_TYPES } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { ReferralSource, SourceReportRow } from '@/lib/types/referrals';

const noSubscribe = () => () => {};

/** Referral sources and how well each converts (D-098), plus the link to the public intake form. */
export default function ReferralSourcesPage() {
  const { request, can, user } = useAuth();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const manage = can('referrals:manage');
  const sources = useQuery({ queryKey: ['referrals', 'sources'], queryFn: async () => (await request<ReferralSource[]>('/referrals/sources')).data });
  const report = useQuery({
    queryKey: ['referrals', 'report', { from, to }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await request<{ from: string; to: string; rows: SourceReportRow[] }>(`/referrals/sources/report?${params}`)).data;
    },
  });
  const create = useMutation({
    mutationFn: (body: Record<string, string>) => request('/referrals/sources', { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['referrals', 'sources'] }),
  });
  const toggle = useMutation({
    mutationFn: (s: ReferralSource) => request(`/referrals/sources/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['referrals', 'sources'] }),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const body: Record<string, string> = {};
    for (const k of ['name', 'sourceType', 'contactName', 'phone', 'email']) {
      const v = String(form.get(k) ?? '').trim();
      if (v) body[k] = v;
    }
    create.mutate(body, { onSuccess: () => formEl.reset() });
  };

  // The dashboard's own origin; empty while rendering on the server.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => '');
  const intakeUrl = origin && user ? `${origin}/intake/${user.agencyId}` : null;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="Referral sources" subtitle="Where referrals come from, and which sources turn into clients." />

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <h2 className="mr-auto text-base font-semibold text-slate-900">Conversion by source</h2>
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {report.data && (
          <p className="text-sm text-slate-600">
            Referrals received {formatDate(report.data.from)} – {formatDate(report.data.to)}. Conversion is admitted ÷ (admitted + lost).
          </p>
        )}
        <ErrorAlert error={report.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Source</th>
              <th className="py-2 pr-4 font-medium">Referrals</th>
              <th className="py-2 pr-4 font-medium">Admitted</th>
              <th className="py-2 pr-4 font-medium">Lost</th>
              <th className="py-2 pr-4 font-medium">Open</th>
              <th className="py-2 pr-4 font-medium">Conversion</th>
              <th className="py-2 font-medium">Avg days to admit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {report.data?.rows.map((row) => (
              <tr key={row.sourceId ?? row.name}>
                <td className="py-2 pr-4 font-medium text-slate-900">{row.name}</td>
                <td className="py-2 pr-4">{row.referrals}</td>
                <td className="py-2 pr-4">{row.admitted}</td>
                <td className="py-2 pr-4">{row.lost}</td>
                <td className="py-2 pr-4">{row.open}</td>
                <td className="py-2 pr-4">{row.conversionRate === null ? '—' : `${row.conversionRate}%`}</td>
                <td className="py-2">{row.avgDaysToAdmit ?? '—'}</td>
              </tr>
            ))}
            {report.data?.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-slate-600">
                  No referrals in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-4 p-4">
        <h2 className="text-base font-semibold text-slate-900">Sources</h2>
        <ErrorAlert error={sources.error ?? toggle.error} />
        <ul className="divide-y divide-slate-100 text-sm">
          {sources.data?.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              <span className={`font-medium ${s.isActive ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{s.name}</span>
              <span className="text-slate-600">{humanize(s.sourceType)}</span>
              <span className="text-slate-600">{[s.contactName, s.phone, s.email].filter(Boolean).join(' · ')}</span>
              {manage && (
                <Button variant="secondary" className="ml-auto" onClick={() => toggle.mutate(s)} disabled={toggle.isPending}>
                  {s.isActive ? 'Archive' : 'Restore'}
                </Button>
              )}
            </li>
          ))}
          {sources.data?.length === 0 && <li className="py-2 text-slate-600">No sources yet.</li>}
        </ul>
        {manage && (
          <form onSubmit={submit} className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <Field label="Name" name="name" required maxLength={200} placeholder="e.g. Riverside Hospital" />
            <SelectField label="Type" name="sourceType" defaultValue="hospital">
              {REFERRAL_SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </SelectField>
            <Field label="Contact name" name="contactName" />
            <Field label="Phone" name="phone" type="tel" />
            <Field label="Email" name="email" type="email" />
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending}>
                Add source
              </Button>
            </div>
            <div className="sm:col-span-3">
              <ErrorAlert error={create.error} />
            </div>
          </form>
        )}
      </Card>

      {intakeUrl && (
        <Card className="flex flex-col gap-2 p-4">
          <h2 className="text-base font-semibold text-slate-900">Website intake form</h2>
          <p className="text-sm text-slate-600">
            Share this link, or embed it on your website. New requests appear here as referrals and the office is notified.
          </p>
          <code className="break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-800">{intakeUrl}</code>
          <code className="break-all rounded-lg bg-slate-50 p-2 text-xs text-slate-800">{`<iframe src="${intakeUrl}" title="Ask about home care" style="width:100%;min-height:900px;border:0"></iframe>`}</code>
        </Card>
      )}
    </div>
  );
}
