'use client';

import { GENDERS } from '@alora/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField, TextAreaField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { PatientDetail, PhysicianOption } from '@/lib/types/patients';

const TEXT_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'gender', 'mrn', 'phoneHome', 'phoneCell', 'email', 'addressLine1',
  'addressLine2', 'city', 'state', 'zip', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation',
  'primaryPhysicianId', 'medicareBeneficiaryId', 'medicaidId', 'insuranceMemberId', 'insuranceGroupNumber', 'notes',
] as const;

/**
 * Admit (no `patient`) or edit (with `patient`). The API validates everything and its field messages are shown as-is,
 * so the rules live in one place. On edit, clearing a field sends null; the SSN is only sent when a new one is typed.
 */
export function PatientForm({
  patient,
  onSubmit,
  submitLabel,
}: {
  patient?: PatientDetail;
  onSubmit(body: Record<string, unknown>): Promise<void>;
  submitLabel: string;
}) {
  const { request, can } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const physicians = useQuery({
    queryKey: ['physicians', 'options'],
    enabled: can('physicians:read'),
    queryFn: async () => (await request<PhysicianOption[]>('/physicians?isActive=true&limit=100')).data,
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const key of TEXT_FIELDS) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = value;
      else if (patient && patient[key as keyof PatientDetail]) body[key] = null; // cleared on edit
    }
    const ssn = String(form.get('ssn') ?? '').trim();
    if (ssn) body.ssn = ssn;
    for (const key of ['latitude', 'longitude'] as const) {
      const value = String(form.get(key) ?? '').trim();
      if (value) body[key] = Number(value);
      else if (patient?.[key] !== null && patient?.[key] !== undefined) body[key] = null;
    }
    const liveIn = form.get('liveIn') === 'on';
    if (patient ? liveIn !== patient.liveIn : liveIn) body.liveIn = liveIn;
    const radius = String(form.get('geoFenceRadiusMeters') ?? '').trim();
    if (radius) body.geoFenceRadiusMeters = Number(radius);
    if (!patient) {
      const admissionDate = String(form.get('admissionDate') ?? '').trim();
      if (admissionDate) body.admissionDate = admissionDate;
    }

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

  const v = (key: keyof PatientDetail) => (patient?.[key] as string | null | undefined) ?? '';

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <ErrorAlert error={error} />

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Patient</h2>
        <Field label="First name" name="firstName" defaultValue={v('firstName')} required />
        <Field label="Last name" name="lastName" defaultValue={v('lastName')} required />
        <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={v('dateOfBirth')} required />
        <SelectField label="Gender" name="gender" defaultValue={v('gender')}>
          <option value="">Not recorded</option>
          {GENDERS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </SelectField>
        <Field label="Medical record number (MRN)" name="mrn" defaultValue={v('mrn')} />
        <Field
          label="Social Security number"
          name="ssn"
          autoComplete="off"
          placeholder={patient?.ssnLast4 ? `On file: •••-••-${patient.ssnLast4}` : '123-45-6789'}
          hint={patient ? 'Leave blank to keep the number on file.' : 'Stored encrypted; only the last 4 digits are ever shown.'}
        />
        {!patient && <Field label="Admission date" name="admissionDate" type="date" hint="Defaults to today." />}
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Contact and address</h2>
        <Field
          label="Home phone"
          name="phoneHome"
          type="tel"
          defaultValue={v('phoneHome')}
          hint="Caregivers clock in and out by phone from this number."
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-800">
          <input type="checkbox" name="liveIn" defaultChecked={patient?.liveIn ?? false} /> Live-in caregiver
          <span className="text-xs text-slate-500">(Virginia personal care claims get the UB modifier)</span>
        </label>
        <Field label="Cell phone" name="phoneCell" type="tel" defaultValue={v('phoneCell')} />
        <Field label="Email" name="email" type="email" defaultValue={v('email')} className="sm:col-span-2" />
        <Field label="Address" name="addressLine1" defaultValue={v('addressLine1')} />
        <Field label="Address line 2" name="addressLine2" defaultValue={v('addressLine2')} />
        <Field label="City" name="city" defaultValue={v('city')} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="State" name="state" maxLength={2} defaultValue={v('state')} placeholder="IL" />
          <Field label="ZIP" name="zip" defaultValue={v('zip')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitude" name="latitude" type="number" step="any" min={-90} max={90} defaultValue={patient?.latitude ?? ''} />
          <Field label="Longitude" name="longitude" type="number" step="any" min={-180} max={180} defaultValue={patient?.longitude ?? ''} />
        </div>
        <Field
          label="EVV geofence radius (meters)"
          name="geoFenceRadiusMeters"
          type="number"
          min={50}
          max={2000}
          defaultValue={patient?.geoFenceRadiusMeters ?? ''}
          hint="How far from the home a caregiver may clock in. Default 200."
        />
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Emergency contact</h2>
        <Field label="Name" name="emergencyContactName" defaultValue={v('emergencyContactName')} />
        <Field label="Phone" name="emergencyContactPhone" type="tel" defaultValue={v('emergencyContactPhone')} />
        <Field label="Relationship" name="emergencyContactRelation" defaultValue={v('emergencyContactRelation')} />
      </Card>

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="text-base font-semibold text-slate-900 sm:col-span-2">Physician and insurance</h2>
        {can('physicians:read') && (
          <SelectField label="Primary physician" name="primaryPhysicianId" defaultValue={v('primaryPhysicianId')} className="sm:col-span-2">
            <option value="">None</option>
            {physicians.data?.map((p) => (
              <option key={p.id} value={p.id}>
                Dr. {p.firstName} {p.lastName}
                {p.practiceName ? ` — ${p.practiceName}` : ''}
              </option>
            ))}
          </SelectField>
        )}
        <Field label="Medicare beneficiary ID (MBI)" name="medicareBeneficiaryId" defaultValue={v('medicareBeneficiaryId')} />
        <Field label="Medicaid ID" name="medicaidId" defaultValue={v('medicaidId')} />
        <Field label="Insurance member ID" name="insuranceMemberId" defaultValue={v('insuranceMemberId')} />
        <Field label="Insurance group number" name="insuranceGroupNumber" defaultValue={v('insuranceGroupNumber')} />
      </Card>

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
