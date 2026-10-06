'use client';

import type { OnboardingChecklist } from '@alora/shared';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

export function ReadinessBar({ percent }: { percent: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <span className={`block h-full ${percent === 100 ? 'bg-emerald-500' : 'bg-violet-600'}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="text-sm font-medium text-slate-800">{percent}% ready</span>
    </span>
  );
}

/** "92% ready" and what's left, on the staff page (D-101). */
export function OnboardingCard({ staffId }: { staffId: string }) {
  const { request } = useAuth();
  const checklist = useQuery({
    queryKey: ['staff', staffId, 'onboarding'],
    queryFn: async () => (await request<OnboardingChecklist>(`/staff/${staffId}/onboarding`)).data,
  });
  const c = checklist.data;
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Onboarding</h2>
        {c && <ReadinessBar percent={c.percent} />}
      </div>
      <ErrorAlert error={checklist.error} />
      {c && (
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {c.items.map((i) => (
            <li key={i.key} className="flex items-start gap-2">
              {i.done ? (
                <CheckCircle2 aria-label="Done" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle aria-label="To do" className={`mt-0.5 h-4 w-4 shrink-0 ${i.required ? 'text-amber-600' : 'text-slate-400'}`} />
              )}
              <span>
                <span className={i.done ? 'text-slate-600' : 'font-medium text-slate-900'}>
                  {i.label}
                  {!i.required && <span className="font-normal text-slate-500"> (optional)</span>}
                </span>
                {i.detail && <span className="block text-xs text-slate-600">{i.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
