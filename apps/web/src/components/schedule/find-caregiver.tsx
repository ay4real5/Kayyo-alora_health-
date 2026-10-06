'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles, UserX, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface Suggestions {
  considered: number;
  suggestions: { staff: { id: string; firstName: string; lastName: string; discipline: string }; score: number; reasons: { text: string; good: boolean }[] }[];
  excluded: { staff: { id: string; firstName: string; lastName: string }; reason: string }[];
}

const scoreTone = (score: number) => (score >= 75 ? 'bg-emerald-50 text-emerald-800' : score >= 50 ? 'bg-violet-50 text-violet-800' : 'bg-amber-50 text-amber-900');

/**
 * Who should take this visit (D-094): ranked caregivers with the reasons, one-click assign (the normal visit update,
 * so the scheduling rules run again), and who can't take it and why.
 */
export function FindCaregiver({ visitId, currentStaffId }: { visitId: string; currentStaffId: string | null }) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const data = useQuery({
    queryKey: ['schedule', 'visit', visitId, 'suggestions'],
    queryFn: async () => (await request<Suggestions>(`/schedule/visits/${visitId}/suggestions`)).data,
    enabled: open,
  });
  const assign = useMutation({
    mutationFn: (staffId: string) => request(`/schedule/visits/${visitId}`, { method: 'PATCH', body: { staffId } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule'] }),
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Find a caregiver</h2>
          <p className="text-sm text-slate-600">Ranked by past visits with this patient, preferences, language, distance, overtime and reliability.</p>
        </div>
        {!open && (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Sparkles aria-hidden className="mr-1.5 inline h-4 w-4" /> Suggest caregivers
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-4 flex flex-col gap-3">
          <ErrorAlert error={data.error ?? assign.error} />
          {data.isLoading && <p className="text-sm text-slate-600">Checking everyone’s schedule…</p>}
          {data.data && data.data.suggestions.length === 0 && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No caregiver of the right discipline is free for this visit. Offer it as an open shift, or change the time.
            </p>
          )}
          <ol className="flex flex-col gap-2">
            {data.data?.suggestions.map((s, i) => {
              const current = s.staff.id === currentStaffId;
              return (
                <li key={s.staff.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`inline-flex h-10 w-12 items-center justify-center rounded-lg text-sm font-semibold ${scoreTone(s.score)}`} title="Match score out of 100">
                      {s.score}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900">
                        {i === 0 && <span className="mr-2 rounded-full bg-violet-700 px-2 py-0.5 text-xs font-medium text-white">Best match</span>}
                        <Link href={`/staff/${s.staff.id}`} className="underline decoration-slate-300 hover:decoration-violet-700">
                          {s.staff.firstName} {s.staff.lastName}
                        </Link>{' '}
                        <span className="text-sm font-normal text-slate-600">{s.staff.discipline}</span>
                      </p>
                    </div>
                    {current ? (
                      <span className="text-sm font-medium text-emerald-800">Assigned</span>
                    ) : (
                      <Button onClick={() => assign.mutate(s.staff.id)} disabled={assign.isPending}>
                        {assign.isPending && assign.variables === s.staff.id ? 'Assigning…' : 'Assign'}
                      </Button>
                    )}
                  </div>
                  {s.reasons.length > 0 && (
                    <ul className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                      {s.reasons.map((r) => (
                        <li key={r.text} className={`flex items-start gap-1.5 ${r.good ? 'text-slate-700' : 'text-amber-900'}`}>
                          {r.good ? <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" /> : <X aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
                          <span>
                            <span className="sr-only">{r.good ? 'In favour: ' : 'Caution: '}</span>
                            {r.text}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          {data.data && data.data.excluded.length > 0 && (
            <div>
              <button type="button" className="text-sm font-medium text-violet-800 underline" onClick={() => setShowExcluded((x) => !x)}>
                {showExcluded ? 'Hide' : 'Show'} {data.data.excluded.length} who can’t take it
              </button>
              {showExcluded && (
                <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-700">
                  {data.data.excluded.map((x) => (
                    <li key={x.staff.id} className="flex items-start gap-1.5">
                      <UserX aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      <span>
                        {x.staff.firstName} {x.staff.lastName} — {x.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
