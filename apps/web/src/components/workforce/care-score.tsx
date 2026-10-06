'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { ErrorAlert, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { scoreTone, type CareScore } from '@/lib/types/workforce';

export function ScorePill({ score }: { score: number | null }) {
  return <span className={`inline-flex min-w-12 justify-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${scoreTone(score)}`}>{score ?? '—'}</span>;
}

/** Each part with the counts behind it, so the number can always be explained. */
export function ScoreParts({ score }: { score: CareScore }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {score.parts.map((p) => (
        <li key={p.key} className="flex items-start gap-3">
          <ScorePill score={p.score} />
          <span>
            <span className="font-medium text-slate-900">{p.label}</span> <span className="text-slate-500">({p.weight}%)</span>
            <span className="block text-slate-600">{p.explanation}</span>
          </span>
        </li>
      ))}
      <li className="text-slate-600">
        Incident reports on their visits: {score.incidents} <span className="text-slate-500">(context only — not scored)</span>
      </li>
    </ul>
  );
}

/** Care Score card on the staff page (D-097). Admins and supervisors only. */
export function CareScoreCard({ staffId }: { staffId: string }) {
  const { request, can } = useAuth();
  const allowed = can('staff:update') && can('reports:read');
  const score = useQuery({
    queryKey: ['insights', 'care-score', staffId],
    enabled: allowed,
    queryFn: async () => (await request<CareScore & { from: string; to: string }>(`/insights/care-scores/${staffId}`)).data,
  });
  if (!allowed) return null;
  const s = score.data;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
          Care Score {s && <ScorePill score={s.score} />}
        </h2>
        <Link href="/staff/care-scores" className="text-sm text-violet-800 hover:underline">
          All caregivers
        </Link>
      </div>
      <ErrorAlert error={score.error} />
      {s && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {formatDate(s.from)} – {formatDate(s.to)}. {s.note ?? 'Decision support only — use it to start a conversation, never on its own.'}
          </p>
          <ScoreParts score={s} />
        </>
      )}
    </Card>
  );
}
