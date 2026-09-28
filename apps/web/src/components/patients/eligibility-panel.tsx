'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, StatusBadge, formatDate } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface EligibilityCheck {
  id: string;
  payer: { name: string };
  traceNumber: string;
  serviceDate: string;
  memberId: string;
  status: 'pending' | 'active' | 'inactive' | 'rejected' | 'unknown';
  planName: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  copay: number | null;
  coinsurancePercent: number | null;
  deductible: number | null;
  deductibleRemaining: number | null;
  errorMessage: string | null;
  respondedAt: string | null;
  createdAt: string;
}

const BADGE: Record<EligibilityCheck['status'], string> = {
  pending: 'pending',
  active: 'active',
  inactive: 'inactive',
  rejected: 'rejected',
  unknown: 'exception',
};
const money = (n: number | null) => (n === null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));

/**
 * Insurance eligibility (D-060): make the 270 for the patient's payer, then upload the payer's 271 answer. Once the
 * clearinghouse is connected (P3-08) the send/receive steps happen by themselves.
 */
export function EligibilityPanel({ patientId }: { patientId: string }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const key = ['patients', patientId, 'eligibility'];
  const checks = useQuery({
    queryKey: key,
    queryFn: async () => (await request<EligibilityCheck[]>(`/billing/eligibility?patientId=${patientId}`)).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => request('/billing/eligibility', { method: 'POST', body: { patientId } }),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => request('/billing/eligibility/responses', { method: 'POST', body: { content: await file.text() } }),
    onSuccess: refresh,
  });
  const download = useMutation({
    mutationFn: async (c: EligibilityCheck) => {
      const blob = (await request<Blob>(`/billing/eligibility/${c.id}/270`, { responseType: 'blob' })).data;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href: url, download: `270-${c.traceNumber}.x12` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });

  const latest = checks.data?.[0];
  const answered = checks.data?.find((c) => c.status !== 'pending');
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Insurance eligibility</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => create.mutate()} disabled={create.isPending}>
            Check eligibility
          </Button>
          {can('billing:update') && (
            <>
              <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                Upload 271 answer
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept=".x12,.edi,.txt,.271"
                className="hidden"
                aria-label="271 file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>
      <ErrorAlert error={checks.error ?? create.error ?? upload.error ?? download.error} />
      {checks.data?.length === 0 && <p className="text-sm text-slate-500">Not checked yet.</p>}
      {answered && (
        <div className="rounded-md border border-slate-200 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge status={BADGE[answered.status]} />
            <span className="font-medium text-slate-900">{answered.payer.name}</span>
            {answered.planName && <span className="text-slate-600">· {answered.planName}</span>}
          </p>
          {answered.errorMessage && <p className="mt-1 text-red-700">{answered.errorMessage}</p>}
          <p className="mt-1 text-slate-700">
            {answered.coverageStart && `Coverage ${formatDate(answered.coverageStart)}${answered.coverageEnd ? ` – ${formatDate(answered.coverageEnd)}` : ''}. `}
            {answered.copay !== null && `Co-pay ${money(answered.copay)}. `}
            {answered.coinsurancePercent !== null && `Co-insurance ${answered.coinsurancePercent}%. `}
            {answered.deductible !== null && `Deductible ${money(answered.deductible)}`}
            {answered.deductibleRemaining !== null && ` (${money(answered.deductibleRemaining)} left)`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            For {formatDate(answered.serviceDate)}, member {answered.memberId}, answered{' '}
            {answered.respondedAt && new Date(answered.respondedAt).toLocaleString()}
          </p>
        </div>
      )}
      {latest?.status === 'pending' && (
        <p className="text-sm text-slate-700">
          Request <span className="font-mono">{latest.traceNumber}</span> is waiting for the payer&apos;s answer.{' '}
          <button type="button" className="underline" onClick={() => download.mutate(latest)}>
            Download the 270
          </button>{' '}
          to send it through your clearinghouse, then upload the 271 they send back.
        </p>
      )}
    </Card>
  );
}
