'use client';

import { ALLERGY_SEVERITIES } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthorizationsPanel } from '@/components/patients/authorizations-panel';
import { ClinicalPanels } from '@/components/patients/clinical-panels';
import { DocumentsPanel } from '@/components/patients/documents-panel';
import { PortalAccessPanel } from '@/components/patients/portal-access-panel';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';
import type { PatientDetail } from '@/lib/types/patients';

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = can('patients:update');

  const patient = useQuery({
    queryKey: ['patients', id],
    queryFn: async () => (await request<PatientDetail>(`/patients/${id}`)).data,
  });

  /** Any change → refetch this patient and the lists. */
  const act = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: 'POST' | 'DELETE'; body?: unknown }) =>
      request(path, { method, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['patients'] }),
  });

  /** Runs an action; errors show in the alert above. Resolves true on success. */
  const run: Act = (v) => act.mutateAsync(v).then(
    () => true,
    () => false,
  );

  if (patient.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!patient.data) return <ErrorAlert error={patient.error} />;
  const p = patient.data;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {p.lastName}, {p.firstName} <StatusBadge status={p.status} />
          </span>
        }
        subtitle={`MRN ${p.mrn ?? '—'} · Born ${formatDate(p.dateOfBirth)}`}
        actions={canEdit && <LifecycleActions patient={p} onAct={run} busy={act.isPending} />}
      />
      <ErrorAlert error={act.error} />

      <Card className="p-5">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Demographics</h2>
        <DetailList
          items={[
            ['Gender', p.gender],
            ['SSN', p.ssnLast4 ? `•••-••-${p.ssnLast4}` : null],
            ['Admitted', formatDate(p.admissionDate)],
            ['Discharged', formatDate(p.dischargeDate)],
            ['Home phone', p.phoneHome],
            ['Cell phone', p.phoneCell],
            ['Email', p.email],
            ['Address', [p.addressLine1, p.addressLine2, p.city, p.state, p.zip].filter(Boolean).join(', ')],
            ['EVV geofence', `${p.geoFenceRadiusMeters} m`],
            ['Home location', p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : 'Not set — clock-ins will be flagged for review'],
          ]}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Emergency contact</h2>
          <DetailList
            items={[
              ['Name', p.emergencyContactName],
              ['Phone', p.emergencyContactPhone],
              ['Relationship', p.emergencyContactRelation],
            ]}
          />
        </Card>
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Insurance</h2>
          <DetailList
            items={[
              ['Medicare (MBI)', p.medicareBeneficiaryId],
              ['Medicaid ID', p.medicaidId],
              ['Member ID', p.insuranceMemberId],
              ['Group number', p.insuranceGroupNumber],
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <DiagnosesPanel patient={p} canEdit={canEdit} onAct={run} />
        <AllergiesPanel patient={p} canEdit={canEdit} onAct={run} />
      </div>

      <ClinicalPanels patientId={p.id} />

      {can('documents:read') && <DocumentsPanel patientId={p.id} />}

      <PortalAccessPanel patientId={p.id} />

      <AuthorizationsPanel patientId={p.id} />

      {p.notes && (
        <Card className="p-5">
          <h2 className="mb-2 text-base font-semibold text-slate-900">Notes</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{p.notes}</p>
        </Card>
      )}
    </div>
  );
}

type Act = (v: { path: string; method: 'POST' | 'DELETE'; body?: unknown }) => Promise<boolean>;

function LifecycleActions({ patient, onAct, busy }: { patient: PatientDetail; onAct: Act; busy: boolean }) {
  const today = useAgencyToday();
  const [date, setDate] = useState(today);
  const discharging = patient.status === 'active';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ButtonLink href={`/patients/${patient.id}/edit`} variant="secondary">
        Edit
      </ButtonLink>
      <Field
        label={discharging ? 'Discharge date' : 'Readmission date'}
        type="date"
        value={date}
        max={today}
        onChange={(e) => setDate(e.target.value)}
      />
      <Button
        variant={discharging ? 'danger' : 'primary'}
        disabled={busy}
        onClick={() => {
          const action = discharging ? 'discharge' : 'readmit';
          if (!window.confirm(`${discharging ? 'Discharge' : 'Readmit'} ${patient.firstName} ${patient.lastName}?`)) return;
          void onAct({
            path: `/patients/${patient.id}/${action}`,
            method: 'POST',
            body: discharging ? { dischargeDate: date } : { admissionDate: date },
          });
        }}
      >
        {discharging ? 'Discharge' : 'Readmit'}
      </Button>
    </div>
  );
}

function DiagnosesPanel({ patient, canEdit, onAct }: { patient: PatientDetail; canEdit: boolean; onAct: Act }) {
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const ok = await onAct({
      path: `/patients/${patient.id}/diagnoses`,
      method: 'POST',
      body: {
        icd10Code: String(form.get('icd10Code')).trim(),
        description: String(form.get('description')).trim() || undefined,
        isPrimary: form.get('isPrimary') === 'on',
      },
    });
    if (ok) formEl.reset(); // keep what was typed if the API refused it
  };
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Diagnoses (ICD-10)</h2>
      <ul className="mb-4 divide-y divide-slate-100 text-sm">
        {patient.diagnoses.map((d) => (
          <li key={d.id} className="flex items-start justify-between gap-2 py-2">
            <span>
              <span className="font-mono font-medium">{d.icd10Code}</span> {d.description}
              {d.isPrimary && <span className="ml-2 rounded bg-teal-50 px-1.5 text-xs text-teal-800">primary</span>}
            </span>
            {canEdit && (
              <Button
                variant="ghost"
                aria-label={`Remove diagnosis ${d.icd10Code}`}
                onClick={() => void onAct({ path: `/patients/${patient.id}/diagnoses/${d.id}`, method: 'DELETE' })}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
        {patient.diagnoses.length === 0 && <li className="py-2 text-slate-500">None recorded.</li>}
      </ul>
      {canEdit && (
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="Code" name="icd10Code" placeholder="E11.9" required />
          <Field label="Description" name="description" />
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" name="isPrimary" /> Primary diagnosis
          </label>
          <Button type="submit" variant="secondary" className="sm:col-span-2 sm:justify-self-start">
            Add diagnosis
          </Button>
        </form>
      )}
    </Card>
  );
}

function AllergiesPanel({ patient, canEdit, onAct }: { patient: PatientDetail; canEdit: boolean; onAct: Act }) {
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const ok = await onAct({
      path: `/patients/${patient.id}/allergies`,
      method: 'POST',
      body: {
        allergen: String(form.get('allergen')).trim(),
        reaction: String(form.get('reaction')).trim() || undefined,
        severity: String(form.get('severity')) || undefined,
      },
    });
    if (ok) formEl.reset(); // keep what was typed if the API refused it
  };
  return (
    <Card className="p-5">
      <h2 className="mb-4 text-base font-semibold text-slate-900">Allergies</h2>
      <ul className="mb-4 divide-y divide-slate-100 text-sm">
        {patient.allergies.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-2 py-2">
            <span>
              <span className="font-medium">{a.allergen}</span>
              {a.reaction && ` — ${a.reaction}`}
              {a.severity && <span className="ml-2 text-xs text-slate-500">({a.severity})</span>}
            </span>
            {canEdit && (
              <Button
                variant="ghost"
                aria-label={`Remove allergy ${a.allergen}`}
                onClick={() => void onAct({ path: `/patients/${patient.id}/allergies/${a.id}`, method: 'DELETE' })}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
        {patient.allergies.length === 0 && <li className="py-2 text-slate-500">No known allergies recorded.</li>}
      </ul>
      {canEdit && (
        <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
          <Field label="Allergen" name="allergen" required />
          <Field label="Reaction" name="reaction" />
          <SelectField label="Severity" name="severity" defaultValue="">
            <option value="">Not recorded</option>
            {ALLERGY_SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
          <Button type="submit" variant="secondary" className="self-end sm:justify-self-start">
            Add allergy
          </Button>
        </form>
      )}
    </Card>
  );
}
