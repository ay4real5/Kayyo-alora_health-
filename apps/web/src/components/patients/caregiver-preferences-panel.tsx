'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Heart, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { StaffSummary } from '@/lib/types/people';

interface Preference {
  staff: { id: string; firstName: string; lastName: string; discipline: string };
  kind: 'preferred' | 'declined';
  note: string | null;
}

/**
 * Caregivers this patient prefers or declines (D-094). Preferred ones rank higher in "Find a caregiver"; declined ones
 * are never suggested. Notes are for the office only.
 */
export function CaregiverPreferencesPanel({ patientId }: { patientId: string }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const key = ['patients', patientId, 'caregiver-preferences'];
  const canEdit = can('patients:update') && can('staff:read');
  const [adding, setAdding] = useState(false);
  const prefs = useQuery({ queryKey: key, queryFn: async () => (await request<Preference[]>(`/patients/${patientId}/caregiver-preferences`)).data });
  const staff = useQuery({
    queryKey: ['staff', 'options'],
    queryFn: async () => (await request<StaffSummary[]>('/staff?isActive=true&limit=100')).data,
    enabled: canEdit && adding,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: (b: { staffId: string; kind: string; note?: string }) =>
      request(`/patients/${patientId}/caregiver-preferences/${b.staffId}`, { method: 'PUT', body: { kind: b.kind, ...(b.note ? { note: b.note } : {}) } }),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (staffId: string) => request(`/patients/${patientId}/caregiver-preferences/${staffId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    save.mutate({ staffId: String(form.get('staffId')), kind: String(form.get('kind')), note: String(form.get('note') ?? '').trim() || undefined });
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Caregiver preferences</h2>
        {canEdit && !adding && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add
          </Button>
        )}
      </div>
      <ErrorAlert error={prefs.error ?? save.error ?? remove.error} />
      {prefs.data?.length === 0 && !adding && <p className="text-sm text-slate-600">None yet. Preferred caregivers are suggested first; declined ones never.</p>}
      <ul className="flex flex-col gap-2">
        {prefs.data?.map((p) => (
          <li key={p.staff.id} className="flex items-start gap-2 text-sm">
            {p.kind === 'preferred' ? (
              <Heart aria-hidden className="mt-0.5 h-4 w-4 text-brand-700" />
            ) : (
              <UserX aria-hidden className="mt-0.5 h-4 w-4 text-rose-700" />
            )}
            <span className="flex-1">
              <span className="font-medium text-slate-900">
                {p.staff.firstName} {p.staff.lastName}
              </span>{' '}
              <span className="text-slate-600">
                ({p.staff.discipline}) — {p.kind === 'preferred' ? 'preferred' : 'declined'}
              </span>
              {p.note && <span className="block text-slate-600">{p.note}</span>}
            </span>
            {canEdit && (
              <button type="button" className="text-sm text-brand-800 underline" onClick={() => remove.mutate(p.staff.id)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Caregiver" name="staffId" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {staff.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName} ({s.discipline})
              </option>
            ))}
          </SelectField>
          <SelectField label="Preference" name="kind" defaultValue="preferred">
            <option value="preferred">Preferred</option>
            <option value="declined">Declined — never suggest</option>
          </SelectField>
          <Field label="Note (office only)" name="note" maxLength={500} className="sm:col-span-2" />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
