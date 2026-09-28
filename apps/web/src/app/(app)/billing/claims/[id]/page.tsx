'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Claim } from '@/lib/types/billing';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** One claim (D-052): what's billed, the QA result, and — while unsent — re-check or void. */
export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const claim = useQuery({
    queryKey: ['billing', 'claim', id],
    queryFn: async () => (await request<Claim>(`/billing/claims/${id}`)).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });
  const qa = useMutation({ mutationFn: () => request(`/billing/claims/${id}/qa`, { method: 'POST' }), onSuccess: refresh });
  const edi = useMutation({
    mutationFn: async () => (await request<{ fileName: string; content: string }>(`/billing/claims/${id}/837`)).data,
    onSuccess: (file) => {
      // Built in the browser from the API's text — nothing is stored on a server.
      const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  const voidClaim = useMutation({
    mutationFn: () => request(`/billing/claims/${id}/void`, { method: 'POST', body: { reason } }),
    onSuccess: refresh,
  });

  if (claim.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!claim.data) return <ErrorAlert error={claim.error} />;
  const c = claim.data;
  const open = c.status === 'draft' || c.status === 'ready';

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Claim <span className="font-mono">{c.claimNumber}</span> <StatusBadge status={c.status === 'void' ? 'cancelled' : c.status} />
          </span>
        }
        subtitle={`${c.payer.name} · ${c.claimType} · ${formatDate(c.billingPeriodStart)} – ${formatDate(c.billingPeriodEnd)}`}
      />
      <Card className="p-5">
        <DetailList
          items={[
            [
              'Patient',
              <Link key="p" href={`/patients/${c.patient.id}`} className="text-teal-800 hover:underline">
                {c.patient.lastName}, {c.patient.firstName} {c.patient.mrn ? `(${c.patient.mrn})` : ''}
              </Link>,
            ],
            ['Member ID', c.memberId ?? '—'],
            ['Diagnoses', c.diagnosisCodes.join(', ') || '—'],
            ['Total charges', money(c.totalCharges)],
            ['Paid', money(c.totalPaid)],
            ['Void reason', c.voidReason],
          ]}
        />
      </Card>

      {c.qaErrors && c.qaErrors.length > 0 && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <h2 className="mb-1 font-semibold">Pre-billing QA problems</h2>
          <ul className="list-disc pl-5">
            {c.qaErrors.map((e) => (
              <li key={e.visitId}>
                <Link href={`/schedule/visits/${e.visitId}`} className="underline">
                  Visit
                </Link>
                : {e.messages.join('; ')}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-4">
        <h2 className="mb-2 font-semibold text-slate-900">Lines</h2>
        <table className="w-full text-left text-sm" aria-label="Claim lines">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">#</th>
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Code</th>
              <th className="py-2 pr-4 font-medium">Units</th>
              <th className="py-2 pr-4 font-medium">Rate</th>
              <th className="py-2 font-medium">Charge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {c.lines.map((l) => (
              <tr key={l.id} className={l.active ? '' : 'text-slate-400 line-through'}>
                <td className="py-2 pr-4">{l.lineNumber}</td>
                <td className="py-2 pr-4">
                  {l.visitId ? (
                    <Link href={`/schedule/visits/${l.visitId}`} className="hover:underline">
                      {formatDate(l.serviceDate)}
                    </Link>
                  ) : (
                    formatDate(l.serviceDate)
                  )}
                </td>
                <td className="py-2 pr-4 font-mono">
                  {l.serviceCode}
                  {l.modifier1 ? `-${l.modifier1}` : ''}
                </td>
                <td className="py-2 pr-4">{l.units}</td>
                <td className="py-2 pr-4">{money(l.unitRate)}</td>
                <td className="py-2">{money(l.chargeAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {c.status !== 'void' && c.claimType === '837P' && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => edi.mutate()} disabled={edi.isPending}>
              Download 837P (preview)
            </Button>
            <span className="text-xs text-slate-500">
              Electronic claim file with the test indicator — for checking, or a clearinghouse test channel.
            </span>
          </div>
          <ErrorAlert error={edi.error} />
        </Card>
      )}

      {open && (
        <Card className="flex flex-col gap-3 p-4">
          <ErrorAlert error={qa.error ?? voidClaim.error} />
          <div className="flex flex-wrap items-end gap-3">
            {can('billing:update') && (
              <Button variant="secondary" onClick={() => qa.mutate()} disabled={qa.isPending}>
                Re-check (QA)
              </Button>
            )}
            {can('billing:void') && (
              <>
                <Field label="Void reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-w-64 flex-1" />
                <Button
                  variant="danger"
                  disabled={!reason.trim() || voidClaim.isPending}
                  onClick={() => window.confirm('Void this claim? Its visits can then be billed again.') && voidClaim.mutate()}
                >
                  Void claim
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-slate-500">Sending to the payer arrives with electronic claims (EDI 837).</p>
        </Card>
      )}
    </div>
  );
}
