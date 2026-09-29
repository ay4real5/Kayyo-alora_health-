'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
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
  // Rejected claims never reached adjudication: fix, re-check (QA) and put them in a new file (D-076).
  const open = c.status === 'draft' || c.status === 'ready' || c.status === 'rejected';

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
            ['Sent to payer', c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : 'Not yet'],
            ['Payer claim number', c.payerClaimNumber ?? '—'],
            ['Void reason', c.voidReason],
          ]}
        />
      </Card>

      {c.rejection && (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-900" role="note" aria-label="Rejection">
          <h2 className="mb-1 font-semibold">Rejected{c.rejection.at ? ` on ${new Date(c.rejection.at).toLocaleDateString()}` : ''}</h2>
          <p>{c.rejection.reason}</p>
          <p className="mt-1 text-red-800">Fix the cause, run Re-check (QA), then put the claim in a new file under Claim files.</p>
        </Card>
      )}

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
              <tr key={l.id} className={l.active ? '' : 'text-slate-500 line-through'}>
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

      <WorkflowCard claim={c} />

      {c.institutional && (
        <InstitutionalCard claimId={c.id} fields={c.institutional} editable={open && can('billing:update')} medicare={c.payer.payerType === 'medicare'} />
      )}

      {c.status !== 'void' && (c.claimType === '837P' || c.claimType === '837I') && (
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => edi.mutate()} disabled={edi.isPending}>
              Download {c.claimType} (preview)
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
          <p className="text-xs text-slate-500">
            Until the clearinghouse is connected, download the claim file, send it through their portal, then mark it as sent.
          </p>
        </Card>
      )}
    </div>
  );
}

/** Type of bill, patient status, HIPPS and CBSA for an institutional (UB-04 / 837I) claim (D-061). */
function InstitutionalCard({
  claimId,
  fields,
  editable,
  medicare,
}: {
  claimId: string;
  fields: NonNullable<Claim['institutional']>;
  editable: boolean;
  medicare: boolean;
}) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, string>) =>
      request(`/billing/claims/${claimId}/institutional`, { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing'] }),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate(Object.fromEntries(['typeOfBill', 'patientStatus', 'hippsCode', 'cbsaCode'].map((k) => [k, String(f.get(k) ?? '').trim()])));
  };
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold text-slate-900">Institutional claim (UB-04)</h2>
      <ErrorAlert error={save.error} />
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <Field label="Type of bill" name="typeOfBill" defaultValue={fields.typeOfBill ?? ''} disabled={!editable} hint="0329 = final claim" />
        <Field label="Patient status" name="patientStatus" defaultValue={fields.patientStatus ?? ''} disabled={!editable} hint="30 = still a patient" />
        <Field label="HIPPS code" name="hippsCode" defaultValue={fields.hippsCode ?? ''} disabled={!editable} hint={medicare ? 'Required by Medicare' : 'Medicare only'} />
        <Field label="CBSA code" name="cbsaCode" defaultValue={fields.cbsaCode ?? ''} disabled={!editable} hint={medicare ? 'Where care was given' : 'Medicare only'} />
        {editable && (
          <div>
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              Save claim details
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Sending, denials, appeals and corrected claims (D-063). */
function WorkflowCard({ claim: c }: { claim: Claim }) {
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });
  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) =>
      (await request<Claim>(`/billing/claims/${c.id}/${path}`, { method: 'POST', body: body ?? {} })).data,
    onSuccess: refresh,
  });
  const rebill = useMutation({
    mutationFn: async (reason: string) =>
      (await request<Claim>(`/billing/claims/${c.id}/rebill`, { method: 'POST', body: { reason } })).data,
    onSuccess: async (created) => {
      await refresh();
      router.push(`/billing/claims/${created.id}`);
    },
  });
  const fileAppeal = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    act.mutate(
      {
        path: 'appeals',
        body: {
          reason: String(f.get('reason') ?? '').trim(),
          reference: String(f.get('reference') ?? '').trim() || undefined,
        },
      },
      { onSuccess: () => form.reset() },
    );
  };
  const pending = c.appeals.find((a) => a.status === 'filed');
  const canSubmit = c.status === 'ready' && can('billing:submit');
  const canAppeal = (c.status === 'denied' || c.status === 'partially_paid') && can('billing:update');
  const canRebill =
    ['submitted', 'acknowledged', 'denied', 'partially_paid', 'paid'].includes(c.status) && can('billing:create');
  if (!canSubmit && !c.denial && !c.appeals.length && !canRebill && !c.originalClaimId) return null;

  const badge = (status: string) =>
    status === 'won' ? 'approved' : status === 'lost' ? 'denied' : status === 'filed' ? 'pending' : 'cancelled';
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="font-semibold text-slate-900">Payer follow-up</h2>
      <ErrorAlert error={act.error ?? rebill.error} />
      {c.originalClaimId && (
        <p className="text-sm text-slate-700">
          Corrected claim replacing{' '}
          <Link href={`/billing/claims/${c.originalClaimId}`} className="text-teal-800 underline">
            the original
          </Link>
          .
        </p>
      )}
      {canSubmit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => act.mutate({ path: 'submit' })} disabled={act.isPending}>
            Mark as sent to payer
          </Button>
          <span className="text-xs text-slate-500">Starts the aging clock.</span>
        </div>
      )}
      {c.denial && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p>
            <strong>Denied</strong>
            {c.denial.reason && ` — reason ${c.denial.reason}`}
            {c.denial.deniedAt && ` on ${new Date(c.denial.deniedAt).toLocaleDateString()}`}
          </p>
          {c.denial.appealDeadline && <p>Appeal by {formatDate(c.denial.appealDeadline)}.</p>}
        </div>
      )}
      {c.appeals.length > 0 && (
        <ul aria-label="Appeals" className="flex flex-col gap-2 text-sm">
          {c.appeals.map((a) => (
            <li key={a.id} className="rounded-md border border-slate-200 p-2">
              <span className="font-medium">Appeal level {a.level}</span> · filed {formatDate(a.filedOn)}
              {a.reference && ` · ref ${a.reference}`} · <StatusBadge status={badge(a.status)} />
              <p className="text-slate-700">{a.reason}</p>
              {a.outcomeNotes && <p className="text-xs text-slate-600">Outcome: {a.outcomeNotes}</p>}
              {a.status === 'filed' && can('billing:update') && (
                <div className="mt-1 flex gap-3 text-xs">
                  {(['won', 'lost', 'withdrawn'] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      className="underline"
                      onClick={() => {
                        const notes = window.prompt(`Appeal ${outcome}. Notes (optional):`);
                        if (notes !== null)
                          act.mutate({
                            path: `appeals/${a.id}/decision`,
                            body: { outcome, notes: notes.trim() || undefined },
                          });
                      }}
                    >
                      {outcome === 'won' ? 'Won' : outcome === 'lost' ? 'Lost' : 'Withdrawn'}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAppeal && !pending && (
        <form onSubmit={fileAppeal} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <Field label="Appeal reason" name="reason" required className="min-w-72 flex-1" />
          <Field label="Payer reference" name="reference" className="w-40" />
          <Button type="submit" variant="secondary" disabled={act.isPending}>
            File appeal
          </Button>
        </form>
      )}
      {canRebill && (
        <div>
          <Button
            variant="secondary"
            disabled={rebill.isPending}
            onClick={() => {
              const reason = window.prompt('What was corrected? A new claim (frequency 7) will replace this one.');
              if (reason?.trim()) rebill.mutate(reason.trim());
            }}
          >
            Create corrected claim
          </Button>
        </div>
      )}
    </Card>
  );
}
