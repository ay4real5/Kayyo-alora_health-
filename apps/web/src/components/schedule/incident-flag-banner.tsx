'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/data-display';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';

export interface IncidentFlag {
  type: string;
  label: string;
  reason: string | null;
  status: string;
}

/**
 * A possible incident found in a submitted note (D-096). People who handle incidents file the prefilled report (or
 * dismiss the flag); everyone else just sees it.
 */
export function IncidentFlagBanner({ visitId, noteId, flag }: { visitId: string; noteId: string; flag: IncidentFlag }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const done = () => queryClient.invalidateQueries({ queryKey: ['schedule', 'visit', visitId] });
  const report = useMutation({
    mutationFn: (body: { severity: string; description: string }) =>
      request<{ incidentId: string }>(`/schedule/visits/${visitId}/notes/${noteId}/incident-flag/report`, { method: 'POST', body }),
    onSuccess: done,
  });
  const dismiss = useMutation({
    mutationFn: () => request(`/schedule/visits/${visitId}/notes/${noteId}/incident-flag/dismiss`, { method: 'POST' }),
    onSuccess: done,
  });

  if (flag.status !== 'open') {
    return (
      <p className="mb-2 text-xs text-slate-600">
        {flag.label}: {flag.status === 'reported' ? 'incident report filed' : 'reviewed and dismissed'}.{' '}
        {flag.status === 'reported' && (
          <Link href="/compliance" className="underline">
            Compliance
          </Link>
        )}
      </p>
    );
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    report.mutate({ severity: String(form.get('severity')), description: String(form.get('description') ?? '') });
  };

  return (
    <div role="alert" className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        {flag.label} — may need an incident report
      </p>
      {flag.reason && <p className="mt-1 pl-6">{flag.reason}</p>}
      <ErrorAlert error={report.error ?? dismiss.error} />
      {!reporting ? (
        <div className="mt-2 flex flex-wrap gap-2 pl-6">
          {can('compliance:create') && <Button onClick={() => setReporting(true)}>File incident report</Button>}
          {can('compliance:update') && (
            <Button variant="secondary" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
              Not an incident — dismiss
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-2 grid gap-2 pl-6 sm:grid-cols-3">
          <SelectField label="Severity" name="severity" defaultValue="moderate">
            <option value="low">Low</option>
            <option value="moderate">Moderate</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </SelectField>
          <TextAreaField label="What happened" name="description" defaultValue={flag.reason ?? ''} className="sm:col-span-2" />
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" disabled={report.isPending}>
              {report.isPending ? 'Filing…' : 'File report'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setReporting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
