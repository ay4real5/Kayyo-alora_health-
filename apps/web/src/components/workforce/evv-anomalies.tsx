'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorAlert, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { ANOMALY_LABELS, type EvvAnomaly } from '@/lib/types/workforce';

/**
 * EVV patterns worth a look (D-097): overlapping visits, impossible travel, repeated corrections or location misses.
 * They describe what was seen, not what it means — a forgotten clock-out or a bad GPS fix is the usual answer.
 */
export function EvvAnomalies() {
  const { request } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const anomalies = useQuery({
    queryKey: ['insights', 'evv-anomalies', { from, to }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return (await request<{ from: string; to: string; items: EvvAnomaly[] }>(`/insights/evv-anomalies?${params}`)).data;
    },
  });
  const data = anomalies.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        {data && (
          <p className="pb-2 text-sm text-slate-600">
            {formatDate(data.from)} – {formatDate(data.to)}
          </p>
        )}
      </div>
      <ErrorAlert error={anomalies.error} />
      {anomalies.isLoading && <p className="text-sm text-slate-500">Looking for patterns…</p>}
      {data && data.items.length === 0 && <p className="text-sm text-slate-600">Nothing unusual in this period.</p>}
      <ul className="flex flex-col gap-2">
        {data?.items.map((a) => (
          <li
            key={`${a.type}-${a.recordIds.join()}`}
            className={`rounded-xl border p-3 text-sm ${a.severity === 'critical' ? 'border-red-200 bg-red-50 text-red-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}
          >
            <p className="flex items-start gap-2 font-semibold">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {ANOMALY_LABELS[a.type]} — {a.staffName}
            </p>
            <p className="mt-1 pl-6">{a.detail}</p>
            <p className="mt-1 flex flex-wrap gap-3 pl-6">
              {a.recordIds.slice(0, 6).map((id, i) => (
                <Link key={id} href={`/evv/${id}`} className="font-medium underline">
                  Record {i + 1}
                </Link>
              ))}
              {a.recordIds.length > 6 && <span>and {a.recordIds.length - 6} more</span>}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
