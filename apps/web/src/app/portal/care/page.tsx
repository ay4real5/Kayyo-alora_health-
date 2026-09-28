'use client';

import { longDate, usePortalData } from '@/components/portal/portal-data';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';

interface CarePlan {
  certificationPeriodStart: string;
  certificationPeriodEnd: string;
  goals: string[] | null;
  interventions: { discipline: string; description: string }[] | null;
  visitFrequency: { discipline: string; frequency: string }[] | null;
  physician: { firstName: string; lastName: string } | null;
}
interface Medication {
  id: string;
  drugName: string;
  dosage: string | null;
  frequency: string | null;
  route: string | null;
}

const DISCIPLINES: Record<string, string> = {
  HHA: 'Home health aide',
  RN: 'Nurse (RN)',
  LPN: 'Nurse (LPN)',
  PT: 'Physical therapy',
  OT: 'Occupational therapy',
  ST: 'Speech therapy',
  MSW: 'Social worker',
};

/** "3W8" → "3 times a week for 8 weeks"; anything else as written. */
function frequency(code: string): string {
  const m = /^(\d+)W(\d+)$/i.exec(code.trim());
  if (!m) return code;
  const [, times, weeks] = m;
  return `${times === '1' ? 'once' : `${times} times`} a week for ${weeks} week${weeks === '1' ? '' : 's'}`;
}

/** The plan of care (read-only) and the current medication list. */
export default function PortalCare() {
  const plan = usePortalData<CarePlan | null>('/care-plan');
  const meds = usePortalData<Medication[]>('/medications');
  const p = plan.data;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Care &amp; medications</h1>
      <ErrorAlert error={plan.error ?? meds.error} />
      <Card className="flex flex-col gap-3 p-5 text-sm">
        <h2 className="text-base font-semibold text-slate-900">Plan of care</h2>
        {plan.data === null && <p className="text-slate-600">There is no active plan of care right now.</p>}
        {p && (
          <>
            <p className="text-slate-700">
              {longDate(p.certificationPeriodStart)} to {longDate(p.certificationPeriodEnd)}
              {p.physician && ` · ordered by Dr. ${p.physician.firstName} ${p.physician.lastName}`}
            </p>
            {!!p.goals?.length && (
              <div>
                <h3 className="font-medium text-slate-900">Goals</h3>
                <ul className="list-disc pl-5 text-slate-800">
                  {p.goals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!p.visitFrequency?.length && (
              <div>
                <h3 className="font-medium text-slate-900">Visits planned</h3>
                <ul aria-label="Visits planned" className="list-disc pl-5 text-slate-800">
                  {p.visitFrequency.map((f) => (
                    <li key={`${f.discipline}-${f.frequency}`}>
                      {DISCIPLINES[f.discipline] ?? f.discipline}: {frequency(f.frequency)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!!p.interventions?.length && (
              <div>
                <h3 className="font-medium text-slate-900">What the team will do</h3>
                <ul className="list-disc pl-5 text-slate-800">
                  {p.interventions.map((i) => (
                    <li key={`${i.discipline}-${i.description}`}>
                      {DISCIPLINES[i.discipline] ?? i.discipline}: {i.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
      <Card className="flex flex-col gap-2 p-5 text-sm">
        <h2 className="text-base font-semibold text-slate-900">Medications</h2>
        {meds.data?.length === 0 && <p className="text-slate-600">No medications on file.</p>}
        <ul aria-label="Medications" className="flex flex-col divide-y divide-slate-100">
          {meds.data?.map((m) => (
            <li key={m.id} className="py-2">
              <span className="font-medium text-slate-900">{m.drugName}</span>{' '}
              <span className="text-slate-700">{[m.dosage, m.route, m.frequency].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          If this list doesn&apos;t match what is being taken at home, please tell the nurse or send a message.
        </p>
      </Card>
    </div>
  );
}
