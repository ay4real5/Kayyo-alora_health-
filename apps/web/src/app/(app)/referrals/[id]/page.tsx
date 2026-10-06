'use client';

import { GENDERS, REFERRAL_PAYER_LABELS, REFERRAL_STATUS_LABELS, REFERRAL_STATUSES, type ReferralPayerType } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ReferralForm } from '@/components/referrals/referral-form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { Referral, ReferralEvent } from '@/lib/types/referrals';

type Detail = Referral & { events: ReferralEvent[] };

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function eventText(e: ReferralEvent): string {
  if (e.eventType === 'created') return 'Referral received';
  if (e.eventType === 'admitted') return 'Admitted as a patient';
  if (e.eventType === 'status') return `Moved to ${REFERRAL_STATUS_LABELS[e.toStatus as keyof typeof REFERRAL_STATUS_LABELS] ?? e.toStatus}`;
  return 'Note';
}

/** One referral (D-098): details, stage, call notes, and admission. */
export default function ReferralPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const key = ['referrals', 'detail', id];
  const referral = useQuery({ queryKey: key, queryFn: async () => (await request<Detail>(`/referrals/${id}`)).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['referrals'] });

  const update = useMutation({
    mutationFn: (body: Record<string, string | null>) => request(`/referrals/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setEditing(false);
      void refresh();
    },
  });
  const status = useMutation({
    mutationFn: (body: { status: string; lostReason?: string; note?: string }) => request(`/referrals/${id}/status`, { method: 'POST', body }),
    onSuccess: () => {
      setNextStatus('');
      void refresh();
    },
  });
  const note = useMutation({
    mutationFn: (text: string) => request(`/referrals/${id}/notes`, { method: 'POST', body: { note: text } }),
    onSuccess: () => void refresh(),
  });
  const admit = useMutation({
    mutationFn: async (body: Record<string, string>) => (await request<{ patientId: string }>(`/referrals/${id}/admit`, { method: 'POST', body })).data,
    onSuccess: (data) => {
      void refresh();
      router.push(`/patients/${data.patientId}`);
    },
  });

  if (referral.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!referral.data) return <ErrorAlert error={referral.error} />;
  const r = referral.data;
  const manage = can('referrals:manage');
  const closed = r.status === 'admitted';

  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get('note') ?? '').trim();
    const reason = String(form.get('lostReason') ?? '').trim();
    status.mutate({ status: nextStatus, ...(text ? { note: text } : {}), ...(nextStatus === 'lost' ? { lostReason: reason } : {}) });
  };
  const submitNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get('note') ?? '').trim();
    if (text) note.mutate(text, { onSuccess: () => form.reset() });
  };
  const submitAdmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {};
    for (const k of ['dateOfBirth', 'gender', 'addressLine1', 'state', 'admissionDate']) {
      const v = String(form.get(k) ?? '').trim();
      if (v) body[k] = v;
    }
    admit.mutate(body);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {r.clientFirstName} {r.clientLastName} <StatusBadge status={r.status} />
          </span>
        }
        subtitle={`Received ${formatDate(r.createdAt.slice(0, 10))} · ${r.channel === 'web_form' ? 'website form' : 'added by staff'}${r.source ? ` · ${r.source.name}` : ''}`}
        actions={
          <>
            {r.patientId && <Link href={`/patients/${r.patientId}`} className="text-sm font-medium text-violet-800 hover:underline">Open patient</Link>}
            {manage && !closed && (
              <Button variant="secondary" onClick={() => setEditing(!editing)}>
                {editing ? 'Cancel' : 'Edit'}
              </Button>
            )}
          </>
        }
      />

      {editing ? (
        <Card className="p-5">
          <ReferralForm initial={r} busy={update.isPending} error={update.error} submitLabel="Save" onSubmit={(body) => update.mutate(body)} />
        </Card>
      ) : (
        <Card className="p-5">
          <DetailList
            items={[
              ['Date of birth', formatDate(r.dateOfBirth)],
              ['Payer', REFERRAL_PAYER_LABELS[r.payerType as ReferralPayerType] ?? r.payerType],
              ['Phone', r.phone],
              ['Email', r.email],
              ['City / ZIP', [r.city, r.zip].filter(Boolean).join(' ')],
              ['Care needs', r.careNeeds],
              ['Contact', [r.contactName, r.contactRelationship && `(${r.contactRelationship})`, r.contactPhone, r.contactEmail].filter(Boolean).join(' ')],
              ['Assigned to', r.assignedTo && `${r.assignedTo.firstName} ${r.assignedTo.lastName}`],
              ['Next follow-up', formatDate(r.nextFollowUp)],
              ['Lost because', r.lostReason],
            ]}
          />
        </Card>
      )}

      {manage && !closed && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-900">Move to a stage</h2>
            <form onSubmit={submitStatus} className="flex flex-col gap-3">
              <SelectField label="Stage" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} required>
                <option value="">Choose…</option>
                {REFERRAL_STATUSES.filter((s) => s !== 'admitted' && s !== r.status).map((s) => (
                  <option key={s} value={s}>
                    {REFERRAL_STATUS_LABELS[s]}
                  </option>
                ))}
              </SelectField>
              {nextStatus === 'lost' && <Field label="Why was it lost?" name="lostReason" required maxLength={500} placeholder="e.g. Chose another agency" />}
              <TextAreaField label="Note (optional)" name="note" maxLength={4000} />
              <ErrorAlert error={status.error} />
              <div>
                <Button type="submit" disabled={!nextStatus || status.isPending}>
                  Update stage
                </Button>
              </div>
            </form>
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-900">Admit</h2>
            {!can('patients:create') ? (
              <p className="text-sm text-slate-600">Someone who can add patients admits the referral.</p>
            ) : r.status === 'lost' ? (
              <p className="text-sm text-slate-600">Move the referral back to an open stage before admitting.</p>
            ) : !admitting ? (
              <>
                <p className="text-sm text-slate-600">Creates the patient from this referral — name, phone, city and contact are copied over.</p>
                <div>
                  <Button onClick={() => setAdmitting(true)}>Admit as patient</Button>
                </div>
              </>
            ) : (
              <form onSubmit={submitAdmit} className="grid gap-3 sm:grid-cols-2">
                <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={r.dateOfBirth ?? ''} required />
                <SelectField label="Gender" name="gender" defaultValue="">
                  <option value="">Not recorded</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {humanize(g)}
                    </option>
                  ))}
                </SelectField>
                <Field label="Street address" name="addressLine1" className="sm:col-span-2" />
                <Field label="State" name="state" maxLength={2} placeholder="VA" />
                <Field label="Admission date" name="admissionDate" type="date" hint="Defaults to today" />
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <ErrorAlert error={admit.error} />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={admit.isPending}>
                      {admit.isPending ? 'Admitting…' : 'Admit'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setAdmitting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">History and notes</h2>
        {manage && !closed && (
          <form onSubmit={submitNote} className="flex flex-col gap-2">
            <TextAreaField label="Add a note" name="note" maxLength={4000} placeholder="e.g. Left a voicemail for the daughter" />
            <ErrorAlert error={note.error} />
            <div>
              <Button type="submit" variant="secondary" disabled={note.isPending}>
                Add note
              </Button>
            </div>
          </form>
        )}
        <ol className="flex flex-col gap-3 text-sm">
          {r.events.map((e) => (
            <li key={e.id} className="border-l-2 border-violet-200 pl-3">
              <p className="font-medium text-slate-900">{eventText(e)}</p>
              {e.note && <p className="whitespace-pre-line text-slate-700">{e.note}</p>}
              <p className="text-xs text-slate-500">
                {when(e.createdAt)}
                {e.by ? ` · ${e.by}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
