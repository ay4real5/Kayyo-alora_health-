'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { ScoreParts, ScorePill } from '@/components/workforce/care-score';
import { useAuth } from '@/lib/auth/auth-provider';
import type { CareScoreRow } from '@/lib/types/workforce';

type Sort = 'name' | 'score';

/** Care Scores for every active caregiver (D-097): explainable decision support for admins and supervisors. */
export default function CareScoresPage() {
  const { request, can } = useAuth();
  const allowed = can('staff:update') && can('reports:read');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [open, setOpen] = useState<string | null>(null);
  const scores = useQuery({
    queryKey: ['insights', 'care-scores', { from, to }],
    enabled: allowed,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await request<{ from: string; to: string; items: CareScoreRow[] }>(`/insights/care-scores?${params}`)).data;
    },
  });

  if (!allowed) return <PageHeader title="Care Scores" subtitle="Only admins and supervisors can see Care Scores." />;
  const rows = [...(scores.data?.items ?? [])];
  if (sort === 'score') rows.sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Care Scores"
        subtitle="Attendance, punctuality, documentation and EVV accuracy from the platform's own records. Decision support only — every number explains itself, and nothing changes automatically."
      />
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className="flex flex-col gap-1 text-sm text-slate-800">
            Sort by
            <select className="rounded-lg border border-slate-300 px-3 py-2" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="name">Name</option>
              <option value="score">Lowest score first</option>
            </select>
          </label>
          {scores.data && (
            <p className="pb-2 text-sm text-slate-600">
              {formatDate(scores.data.from)} – {formatDate(scores.data.to)}
            </p>
          )}
        </div>
        <ErrorAlert error={scores.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Caregiver</th>
              <th className="py-2 pr-4 font-medium">Score</th>
              <th className="py-2 pr-4 font-medium">Visits</th>
              {['Attendance', 'Punctuality', 'Notes', 'EVV'].map((h) => (
                <th key={h} className="hidden py-2 pr-4 font-medium md:table-cell">
                  {h}
                </th>
              ))}
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <Fragment key={r.staffId}>
                <tr>
                  <td className="py-2 pr-4">
                    <Link href={r.link} className="font-medium text-violet-800 hover:underline">
                      {r.name}
                    </Link>{' '}
                    <span className="text-slate-500">({r.discipline})</span>
                  </td>
                  <td className="py-2 pr-4">
                    <ScorePill score={r.score} />
                  </td>
                  <td className="py-2 pr-4">{r.visits}</td>
                  {r.parts.map((p) => (
                    <td key={p.key} className="hidden py-2 pr-4 md:table-cell">
                      {p.score ?? '—'}
                    </td>
                  ))}
                  <td className="py-2 text-right">
                    <button type="button" className="text-violet-800 hover:underline" aria-expanded={open === r.staffId} onClick={() => setOpen(open === r.staffId ? null : r.staffId)}>
                      {open === r.staffId ? 'Hide' : 'Why?'}
                    </button>
                  </td>
                </tr>
                {open === r.staffId && (
                  <tr>
                    <td colSpan={8} className="bg-slate-50 px-4 py-3">
                      {r.note && <p className="mb-2 text-sm text-slate-600">{r.note}</p>}
                      <ScoreParts score={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
