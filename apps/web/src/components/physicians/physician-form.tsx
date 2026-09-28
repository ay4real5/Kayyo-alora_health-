'use client';

import { isValidNpi } from '@alora/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import type { Physician } from '@/lib/types/people';

const FIELDS = ['firstName', 'lastName', 'npi', 'practiceName', 'phone', 'fax', 'email', 'addressLine1', 'city', 'state', 'zip'] as const;

/** Add (no `physician`) or edit. The NPI check digit is checked as you type; the API is the final judge. */
export function PhysicianForm({
  physician,
  submitLabel,
  onSubmit,
}: {
  physician?: Physician;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): Promise<void>;
}) {
  const [npi, setNpi] = useState(physician?.npi ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const npiProblem = npi && !isValidNpi(npi.trim()) ? 'Not a valid NPI — check the digits' : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const key of FIELDS) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = value;
      else if (physician?.[key]) body[key] = null;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const v = (key: (typeof FIELDS)[number]) => physician?.[key] ?? '';
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ErrorAlert error={error} />
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="First name" name="firstName" defaultValue={v('firstName')} required />
        <Field label="Last name" name="lastName" defaultValue={v('lastName')} required />
        <Field
          label="NPI"
          name="npi"
          inputMode="numeric"
          maxLength={10}
          value={npi}
          onChange={(e) => setNpi(e.target.value)}
          error={npiProblem}
          hint="10-digit National Provider Identifier"
        />
        <Field label="Practice" name="practiceName" defaultValue={v('practiceName')} />
        <Field label="Phone" name="phone" type="tel" defaultValue={v('phone')} />
        <Field label="Fax" name="fax" type="tel" defaultValue={v('fax')} hint="Orders and care plans are faxed for signature." />
        <Field label="Email" name="email" type="email" defaultValue={v('email')} />
        <Field label="Address" name="addressLine1" defaultValue={v('addressLine1')} />
        <Field label="City" name="city" defaultValue={v('city')} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="State" name="state" maxLength={2} defaultValue={v('state')} />
          <Field label="ZIP" name="zip" defaultValue={v('zip')} />
        </div>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || Boolean(npiProblem)}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
