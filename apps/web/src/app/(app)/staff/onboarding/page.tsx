'use client';

import { credentialTypeLabel, DISCIPLINES } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ReadinessBar } from '@/components/staff/onboarding-card';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface Row {
  staffId: string;
  name: string;
  discipline: string;
  percent: number;
  ready: boolean;
  missing: string[];
}

/** Who is ready to work and what's left for the rest (D-101), plus the credentials each discipline needs. */
export default function OnboardingPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [showReady, setShowReady] = useState(false);
  const overview = useQuery({ queryKey: ['staff', 'onboarding'], queryFn: async () => (await request<Row[]>('/staff/onboarding')).data });
  const requirements = useQuery({
    queryKey: ['staff', 'onboarding', 'requirements'],
    queryFn: async () => (await request<Record<string, string[]>>('/staff/onboarding/requirements')).data,
  });
  const save = useMutation({
    mutationFn: (body: Record<string, string[]>) => request('/staff/onboarding/requirements', { method: 'PUT', body: { requirements: body } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff', 'onboarding'] }),
  });
  const editable = can('settings:update');
  const rows = overview.data?.filter((r) => showReady || !r.ready) ?? [];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate(
      Object.fromEntries(
        DISCIPLINES.map((d) => [
          d,
          String(form.get(d) ?? '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        ]),
      ),
    );
  };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="Onboarding" subtitle="Who is ready to work, and what's still missing for everyone else." />
      <Card className="flex flex-col gap-3 p-4">
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input type="checkbox" checked={showReady} onChange={(e) => setShowReady(e.target.checked)} /> Show people who are ready too
        </label>
        <ErrorAlert error={overview.error} />
        {overview.data && rows.length === 0 && <p className="text-sm text-slate-600">Everyone is ready to work.</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.staffId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/staff/${r.staffId}`} className="w-56 font-medium text-violet-800 hover:underline">
                {r.name} <span className="font-normal text-slate-500">({r.discipline})</span>
              </Link>
              <ReadinessBar percent={r.percent} />
              {r.missing.length > 0 && <span className="text-slate-600">Missing: {r.missing.join(', ')}</span>}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-base font-semibold text-slate-900">Required credentials by discipline</h2>
        <p className="text-sm text-slate-600">
          Credential types, comma-separated, matched against each person&apos;s Credentials (the type field; case and spaces don&apos;t matter).
        </p>
        <ErrorAlert error={requirements.error ?? save.error} />
        {save.isSuccess && <Alert tone="info">Saved.</Alert>}
        {requirements.data && (
          <form key={JSON.stringify(requirements.data)} onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            {DISCIPLINES.map((d) => (
              <label key={d} className="flex flex-col gap-1 text-sm text-slate-800">
                <span className="font-medium">{d}</span>
                <input
                  name={d}
                  defaultValue={requirements.data[d]?.join(', ') ?? ''}
                  disabled={!editable}
                  className="rounded-xl border border-slate-200 px-3 py-2"
                  aria-describedby={`${d}-hint`}
                />
                <span id={`${d}-hint`} className="text-xs text-slate-500">
                  {(requirements.data[d] ?? []).map(credentialTypeLabel).join(' · ') || 'Nothing required'}
                </span>
              </label>
            ))}
            {editable && (
              <div className="sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  Save requirements
                </Button>
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
