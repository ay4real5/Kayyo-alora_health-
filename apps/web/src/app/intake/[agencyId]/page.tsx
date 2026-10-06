'use client';

import { REFERRAL_PAYER_LABELS, REFERRAL_PAYER_TYPES } from '@alora/shared';
import { CheckCircle2, HeartHandshake } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { apiRequest } from '@/lib/api';

/**
 * The public "I need care" form (D-098). No sign-in; it can be embedded on the agency's website (frame-ancestors from
 * INTAKE_FRAME_ANCESTORS). It asks only for what the office needs to call back — no medical records.
 */
export default function IntakePage() {
  const { agencyId } = useParams<{ agencyId: string }>();
  const [forSelf, setForSelf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const v = String(form.get(key) ?? '').trim();
      return v || undefined;
    };
    const body = {
      submittedBy: forSelf ? 'self' : 'someone_else',
      consent: form.get('consent') === 'on',
      website: text('website'),
      clientFirstName: text('clientFirstName'),
      clientLastName: text('clientLastName'),
      phone: text('phone'),
      email: text('email'),
      city: text('city'),
      zip: text('zip'),
      payerType: text('payerType'),
      careNeeds: text('careNeeds'),
      ...(forSelf
        ? {}
        : { contactName: text('contactName'), contactRelationship: text('contactRelationship'), contactPhone: text('contactPhone'), contactEmail: text('contactEmail') }),
    };
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/intake/${agencyId}`, { method: 'POST', body });
      setSent(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <CheckCircle2 aria-hidden className="h-12 w-12 text-emerald-600" />
        <h1 className="text-2xl font-semibold text-slate-900">Thank you — we&apos;ve got it</h1>
        <p className="text-slate-700">Someone from our care team will call you back, usually within one business day. If it&apos;s an emergency, call 911.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <HeartHandshake aria-hidden className="h-9 w-9 text-violet-700" />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Ask about home care</h1>
          <p className="text-sm text-slate-600">Tell us a little about who needs care and we&apos;ll call you back. No cost, no obligation.</p>
        </div>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Who needs care?</legend>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="who" checked={!forSelf} onChange={() => setForSelf(false)} /> Someone I care for (a parent, spouse, client…)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input type="radio" name="who" checked={forSelf} onChange={() => setForSelf(true)} /> Me
          </label>
        </fieldset>

        <Field label={forSelf ? 'Your first name' : 'Their first name'} name="clientFirstName" required maxLength={100} autoComplete={forSelf ? 'given-name' : 'off'} />
        <Field label={forSelf ? 'Your last name' : 'Their last name'} name="clientLastName" required maxLength={100} autoComplete={forSelf ? 'family-name' : 'off'} />
        {forSelf && (
          <>
            <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
            <Field label="Email (optional)" name="email" type="email" autoComplete="email" />
          </>
        )}
        <Field label="City" name="city" maxLength={100} />
        <Field label="ZIP code" name="zip" inputMode="numeric" maxLength={10} />
        <SelectField label="How will care be paid for?" name="payerType" defaultValue="unknown" className="sm:col-span-2">
          {REFERRAL_PAYER_TYPES.map((p) => (
            <option key={p} value={p}>
              {REFERRAL_PAYER_LABELS[p]}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label="What kind of help is needed?"
          name="careNeeds"
          maxLength={4000}
          rows={4}
          placeholder="e.g. Help with bathing and meals a few mornings a week after a hospital stay."
          className="sm:col-span-2"
        />

        {!forSelf && (
          <>
            <h2 className="mt-2 text-base font-semibold text-slate-900 sm:col-span-2">How can we reach you?</h2>
            <Field label="Your name" name="contactName" required maxLength={200} autoComplete="name" />
            <Field label="Relationship" name="contactRelationship" maxLength={50} placeholder="e.g. daughter" />
            <Field label="Your phone" name="contactPhone" type="tel" autoComplete="tel" />
            <Field label="Your email (optional)" name="contactEmail" type="email" autoComplete="email" />
          </>
        )}

        {/* Bots fill this in; people never see it. */}
        <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
          <label>
            Website <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>

        <label className="flex items-start gap-2 text-sm text-slate-800 sm:col-span-2">
          <input type="checkbox" name="consent" required className="mt-1" />
          <span>I agree to be contacted about home care by phone or email. Please don&apos;t include medical records here — we&apos;ll talk through details on the call.</span>
        </label>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <ErrorAlert error={error} />
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Request a call back'}
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
