'use client';

import { REFERRAL_PAYER_LABELS, REFERRAL_PAYER_TYPES } from '@alora/shared';
import { useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { Referral, ReferralSource } from '@/lib/types/referrals';

interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
}

const TEXT_FIELDS = [
  'clientFirstName',
  'clientLastName',
  'dateOfBirth',
  'phone',
  'email',
  'city',
  'zip',
  'payerType',
  'careNeeds',
  'contactName',
  'contactRelationship',
  'contactPhone',
  'contactEmail',
] as const;
const LINK_FIELDS = ['sourceId', 'assignedToId', 'nextFollowUp'] as const;

/**
 * Add or edit a referral (D-098). On edit only changed fields are sent; clearing the source, assignee or follow-up
 * sends null.
 */
export function ReferralForm({
  initial,
  busy,
  error,
  submitLabel,
  onSubmit,
}: {
  initial?: Referral;
  busy: boolean;
  error: unknown;
  submitLabel: string;
  onSubmit: (body: Record<string, string | null>) => void;
}) {
  const { request, can } = useAuth();
  const sources = useQuery({ queryKey: ['referrals', 'sources'], queryFn: async () => (await request<ReferralSource[]>('/referrals/sources')).data });
  const users = useQuery({
    queryKey: ['users', 'assignable'],
    enabled: can('users:read'),
    queryFn: async () => (await request<StaffUser[]>('/users?limit=100&isActive=true')).data,
  });

  const current = (key: string): string => {
    if (!initial) return '';
    if (key === 'sourceId') return initial.source?.id ?? '';
    if (key === 'assignedToId') return initial.assignedTo?.id ?? '';
    return ((initial as unknown as Record<string, unknown>)[key] as string | null) ?? '';
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | null> = {};
    for (const key of [...TEXT_FIELDS, ...LINK_FIELDS]) {
      if (!form.has(key)) continue;
      const value = String(form.get(key) ?? '').trim();
      if (value === current(key)) continue;
      if (value) body[key] = value;
      else if (initial && (LINK_FIELDS as readonly string[]).includes(key)) body[key] = null;
    }
    onSubmit(body);
  };

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="First name" name="clientFirstName" required defaultValue={current('clientFirstName')} maxLength={100} />
      <Field label="Last name" name="clientLastName" required defaultValue={current('clientLastName')} maxLength={100} />
      <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={current('dateOfBirth')} hint="Needed to admit" />
      <SelectField label="Payer" name="payerType" defaultValue={current('payerType') || 'unknown'}>
        {REFERRAL_PAYER_TYPES.map((p) => (
          <option key={p} value={p}>
            {REFERRAL_PAYER_LABELS[p]}
          </option>
        ))}
      </SelectField>
      <Field label="Phone" name="phone" type="tel" defaultValue={current('phone')} />
      <Field label="Email" name="email" type="email" defaultValue={current('email')} />
      <Field label="City" name="city" defaultValue={current('city')} />
      <Field label="ZIP" name="zip" defaultValue={current('zip')} />
      <TextAreaField label="Care needs" name="careNeeds" defaultValue={current('careNeeds')} maxLength={4000} className="sm:col-span-2" />

      <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Contact person (if not the client)</h2>
      <Field label="Name" name="contactName" defaultValue={current('contactName')} />
      <Field label="Relationship" name="contactRelationship" defaultValue={current('contactRelationship')} placeholder="e.g. daughter, discharge planner" />
      <Field label="Phone" name="contactPhone" type="tel" defaultValue={current('contactPhone')} />
      <Field label="Email" name="contactEmail" type="email" defaultValue={current('contactEmail')} />

      <h2 className="text-sm font-semibold text-slate-900 sm:col-span-2">Tracking</h2>
      <SelectField label="Source" name="sourceId" defaultValue={current('sourceId')}>
        <option value="">No source</option>
        {sources.data
          ?.filter((s) => s.isActive || s.id === current('sourceId'))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </SelectField>
      {users.data ? (
        <SelectField label="Assigned to" name="assignedToId" defaultValue={current('assignedToId')}>
          <option value="">Nobody</option>
          {users.data.map((u) => (
            <option key={u.id} value={u.id}>
              {u.firstName} {u.lastName}
            </option>
          ))}
        </SelectField>
      ) : (
        <div />
      )}
      <Field label="Next follow-up" name="nextFollowUp" type="date" defaultValue={current('nextFollowUp')} />

      <div className="flex flex-col gap-2 sm:col-span-2">
        <ErrorAlert error={error} />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
