'use client';

import { REFERRAL_PAYER_LABELS, REFERRAL_STATUS_LABELS, type ReferralPayerType, type ReferralStatus } from '@alora/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Globe, Phone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Referral } from '@/lib/types/referrals';

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

function ReferralCard({ r }: { r: Referral }) {
  const days = daysSince(r.statusChangedAt);
  return (
    <Link href={`/referrals/${r.id}`} className="block rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm hover:border-brand-300">
      <p className="font-medium text-slate-900">
        {r.clientFirstName} {r.clientLastName}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
        {r.channel === 'web_form' ? <Globe aria-hidden className="h-3 w-3" /> : <Phone aria-hidden className="h-3 w-3" />}
        {r.source?.name ?? (r.channel === 'web_form' ? 'Website form' : 'No source')}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {REFERRAL_PAYER_LABELS[r.payerType as ReferralPayerType] ?? r.payerType}
        {r.city ? ` · ${r.city}` : ''}
      </p>
      <p className={`mt-1 text-xs ${days >= 3 && r.status === 'new' ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
        {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} in this stage`}
        {r.nextFollowUp ? ` · follow up ${formatDate(r.nextFollowUp)}` : ''}
      </p>
    </Link>
  );
}

/** The referral pipeline (D-098): a board of open referrals by stage, or a searchable list of all of them. */
export default function ReferralsPage() {
  const { request, can } = useAuth();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const board = useQuery({
    queryKey: ['referrals', 'board'],
    enabled: view === 'board',
    queryFn: async () => (await request<{ status: ReferralStatus; referrals: Referral[] }[]>('/referrals/board')).data,
  });
  const list = useQuery({
    queryKey: ['referrals', 'list', { status, search, page }],
    enabled: view === 'list',
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (status) params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      return request<Referral[]>(`/referrals?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Referrals"
        subtitle="People asking about care, from first call to admission."
        actions={
          <>
            <ButtonLink href="/referrals/sources" variant="secondary">
              Sources &amp; report
            </ButtonLink>
            {can('referrals:manage') && <ButtonLink href="/referrals/new">Add referral</ButtonLink>}
          </>
        }
      />
      <div role="tablist" className="flex gap-2">
        {(
          [
            ['board', 'Pipeline'],
            ['list', 'All referrals'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            onClick={() => setView(key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${view === key ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'board' ? (
        <>
          <ErrorAlert error={board.error} />
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {board.data?.map((column) => (
              <section key={column.status} className="flex flex-col gap-2 rounded-2xl bg-slate-50 p-3">
                <h2 className="flex items-center justify-between text-sm font-semibold text-slate-800">
                  {REFERRAL_STATUS_LABELS[column.status]}
                  <span className="rounded-full bg-white px-2 text-xs text-slate-600 ring-1 ring-slate-200">{column.referrals.length}</span>
                </h2>
                {column.referrals.map((r) => (
                  <ReferralCard key={r.id} r={r} />
                ))}
                {column.referrals.length === 0 && <p className="text-xs text-slate-500">None</p>}
              </section>
            ))}
          </div>
        </>
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Search" value={search} placeholder="Name, phone or email" onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <SelectField label="Stage" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Any</option>
              <option value="open">Open (not admitted or lost)</option>
              {Object.entries(REFERRAL_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
          </div>
          <ErrorAlert error={list.error} />
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-2 pr-4 font-medium">Client</th>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 pr-4 font-medium">Received</th>
                <th className="py-2 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data?.data.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 pr-4">
                    <Link href={`/referrals/${r.id}`} className="font-medium text-brand-800 hover:underline">
                      {r.clientLastName}, {r.clientFirstName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{r.source?.name ?? (r.channel === 'web_form' ? 'Website form' : '—')}</td>
                  <td className="py-2 pr-4">{formatDate(r.createdAt.slice(0, 10))}</td>
                  <td className="py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.data?.meta && <Pager page={list.data.meta.page} limit={list.data.meta.limit} total={list.data.meta.total} onPage={setPage} />}
        </Card>
      )}
    </div>
  );
}
