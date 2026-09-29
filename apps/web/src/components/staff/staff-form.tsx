'use client';

import { DISCIPLINES, EMPLOYMENT_TYPES } from '@alora/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { humanize } from '@/lib/labels';
import type { StaffCandidate, StaffDetail } from '@/lib/types/people';

const TEXT = ['employeeId', 'discipline', 'employmentType', 'hireDate', 'addressLine1', 'city', 'state', 'zip', 'notes', 'taxFilingStatus'] as const;
const MONEY = ['hourlyRate', 'perVisitRate', 'overtimeRate', 'mileageRate'] as const;
const LISTS = ['serviceAreaZipCodes', 'skills', 'languages'] as const;

/**
 * Create (with `candidates`) or edit (with `staff`) a staff profile. Pay fields appear only when the user may see
 * pay (`showPay`) — the API hides them from everyone else anyway.
 */
export function StaffForm({
  staff,
  candidates,
  showPay,
  submitLabel,
  onSubmit,
}: {
  staff?: StaffDetail;
  candidates?: StaffCandidate[];
  showPay: boolean;
  submitLabel: string;
  onSubmit(body: Record<string, unknown>): Promise<void>;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    if (!staff) body.userId = form.get('userId');
    for (const key of TEXT) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = value;
    }
    for (const key of MONEY) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = Number(value);
    }
    for (const key of LISTS) {
      const raw = form.get(key);
      if (raw === null) continue;
      body[key] = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
    }
    // Write-only like the SSN: blank keeps the code on file.
    const ivrCode = String(form.get('ivrCode') ?? '').trim();
    if (ivrCode) body.ivrCode = ivrCode;
    const ssn = String(form.get('ssn') ?? '').trim();
    if (ssn) body.ssn = ssn;
    const maxPatients = String(form.get('maxPatients') ?? '').trim();
    if (maxPatients) body.maxPatients = Number(maxPatients);

    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
    } catch (e) {
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const v = (key: keyof StaffDetail) => (staff?.[key] as string | null | undefined) ?? '';
  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <ErrorAlert error={error} />
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Employment</h2>
        {!staff && (
          <SelectField label="Person" name="userId" required defaultValue="" className="sm:col-span-2">
            <option value="" disabled>
              Choose a user without a staff profile…
            </option>
            {candidates?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.lastName}, {c.firstName} — {c.email}
              </option>
            ))}
          </SelectField>
        )}
        <SelectField label="Discipline" name="discipline" defaultValue={v('discipline')} required>
          <option value="" disabled>
            Choose…
          </option>
          {DISCIPLINES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField label="Employment type" name="employmentType" defaultValue={v('employmentType') || 'full_time'}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </SelectField>
        <Field
          label="Employee ID"
          name="employeeId"
          defaultValue={v('employeeId')}
          hint="Letters and digits; goes on Virginia Medicaid claims (never the SSN)."
        />
        <Field
          label="Phone check-in code"
          name="ivrCode"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{4,8}"
          placeholder={staff?.hasPhoneCheckInCode ? 'Set — enter a new one to change it' : '4 to 8 digits'}
          hint="Keyed in when clocking in or out by phone from the patient's home line."
        />
        <Field label="Hire date" name="hireDate" type="date" defaultValue={v('hireDate')} />
        <Field label="Max patients" name="maxPatients" type="number" min={1} defaultValue={staff?.maxPatients ?? ''} />
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Skills and coverage</h2>
        <Field
          label="Service area ZIP codes"
          name="serviceAreaZipCodes"
          defaultValue={staff?.serviceAreaZipCodes.join(', ') ?? ''}
          hint="Comma-separated 5-digit ZIPs."
          className="sm:col-span-2"
        />
        <Field label="Skills" name="skills" defaultValue={staff?.skills.join(', ') ?? ''} hint="Comma-separated." />
        <Field label="Languages" name="languages" defaultValue={staff?.languages.join(', ') ?? ''} hint="Comma-separated." />
        <Field label="Home address" name="addressLine1" defaultValue={v('addressLine1')} />
        <Field label="City" name="city" defaultValue={v('city')} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="State" name="state" maxLength={2} defaultValue={v('state')} />
          <Field label="ZIP" name="zip" defaultValue={v('zip')} />
        </div>
      </Card>

      {showPay && (
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Pay (visible to payroll only)</h2>
          <Field label="Hourly rate ($)" name="hourlyRate" type="number" step="0.01" min={0} defaultValue={staff?.pay?.hourlyRate ?? ''} />
          <Field label="Per-visit rate ($)" name="perVisitRate" type="number" step="0.01" min={0} defaultValue={staff?.pay?.perVisitRate ?? ''} />
          <Field label="Overtime rate ($)" name="overtimeRate" type="number" step="0.01" min={0} defaultValue={staff?.pay?.overtimeRate ?? ''} />
          <Field label="Mileage rate ($/mile)" name="mileageRate" type="number" step="0.0001" min={0} defaultValue={staff?.pay?.mileageRate ?? ''} />
          <SelectField label="Tax filing status" name="taxFilingStatus" defaultValue={staff?.pay?.taxFilingStatus ?? ''}>
            <option value="">Not recorded</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="married_separately">Married filing separately</option>
            <option value="head_of_household">Head of household</option>
          </SelectField>
          <Field
            label="Social Security number"
            name="ssn"
            autoComplete="off"
            placeholder={staff?.pay?.ssnLast4 ? `On file: •••-••-${staff.pay.ssnLast4}` : '123-45-6789'}
            hint="Stored encrypted. Leave blank to keep the number on file."
          />
        </Card>
      )}

      <Card className="p-5">
        <TextAreaField label="Notes" name="notes" defaultValue={v('notes')} />
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
