'use client';

import { clock, longDate, usePortalData, type PortalVisit } from '@/components/portal/portal-data';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { humanize } from '@/lib/labels';

const STATUS: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'Happening now',
  completed: 'Done',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

function VisitList({ label, visits, empty }: { label: string; visits: PortalVisit[] | undefined; empty: string }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{label}</h2>
      {visits?.length === 0 && <p className="text-sm text-slate-600">{empty}</p>}
      <ul aria-label={label} className="flex flex-col divide-y divide-slate-100">
        {visits?.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-medium text-slate-900">{longDate(v.date)}</span>{' '}
              <span className="text-slate-700">
                {clock(v.start)} – {clock(v.end)}
              </span>
              <span className="block text-xs text-slate-600">
                {humanize(v.visitType)}
                {v.caregiver && ` · ${v.caregiver}`}
              </span>
              {v.careUpdate && (
                <span className="mt-1 block rounded-lg bg-violet-50 px-2 py-1 text-sm text-violet-950">
                  “{v.careUpdate.summary}”{v.careUpdate.mood && <span className="text-violet-800"> · Mood: {v.careUpdate.mood}</span>}
                </span>
              )}
            </span>
            <span className="text-xs font-medium text-slate-700">{STATUS[v.status] ?? humanize(v.status)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Upcoming visits (next 30 days) and recent ones (last 30 days). */
export default function PortalVisits() {
  const visits = usePortalData<{ upcoming: PortalVisit[]; recent: PortalVisit[] }>('/visits');
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Visits</h1>
      <ErrorAlert error={visits.error} />
      <VisitList label="Coming up" visits={visits.data?.upcoming} empty="No visits scheduled in the next 30 days." />
      <VisitList label="Recent visits" visits={visits.data?.recent} empty="No visits in the last 30 days." />
    </div>
  );
}
