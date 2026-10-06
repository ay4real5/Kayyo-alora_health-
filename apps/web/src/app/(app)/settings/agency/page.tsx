'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';

interface Agency {
  id: string;
  name: string;
  npi: string | null;
  taxId: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  timezone: string;
  recognitionBadges: boolean;
}

const FIELDS = ['name', 'npi', 'taxId', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'zip'] as const;

/** The agency profile claims are billed under (D-053). Admins edit; the timezone is fixed. */
export default function AgencySettingsPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const agency = useQuery({
    queryKey: ['agency'],
    enabled: can('settings:read'),
    queryFn: async () => (await request<Agency>('/agency')).data,
  });
  const save = useMutation({
    mutationFn: (body: Record<string, string>) => request<Agency>('/agency', { method: 'PATCH', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agency'] }),
  });
  const recognition = useMutation({
    mutationFn: (recognitionBadges: boolean) => request<Agency>('/agency', { method: 'PATCH', body: { recognitionBadges } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agency'] }),
  });

  if (!can('settings:read')) return <PageHeader title="Agency settings" subtitle="You don't have access to settings." />;
  const a = agency.data;
  const editable = can('settings:update');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = {};
    for (const key of FIELDS) {
      const value = String(form.get(key) ?? '').trim();
      if (value && value !== (a?.[key] ?? '')) body[key] = value;
    }
    save.mutate(body);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Agency settings" subtitle="Who claims are billed under." />
      <ErrorAlert error={agency.error} />
      {a && (
        <Card className="p-5">
          <form key={JSON.stringify(a)} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency name" name="name" defaultValue={a.name} disabled={!editable} className="sm:col-span-2" />
            <Field label="NPI" name="npi" defaultValue={a.npi ?? ''} disabled={!editable} hint="10 digits" />
            <Field label="Tax ID (EIN)" name="taxId" defaultValue={a.taxId ?? ''} disabled={!editable} hint="e.g. 12-3456789" />
            <Field label="Phone" name="phone" defaultValue={a.phone ?? ''} disabled={!editable} />
            <div />
            <Field label="Street address" name="addressLine1" defaultValue={a.addressLine1 ?? ''} disabled={!editable} className="sm:col-span-2" />
            <Field label="Address line 2" name="addressLine2" defaultValue={a.addressLine2 ?? ''} disabled={!editable} className="sm:col-span-2" />
            <Field label="City" name="city" defaultValue={a.city ?? ''} disabled={!editable} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" name="state" defaultValue={a.state ?? ''} disabled={!editable} maxLength={2} />
              <Field label="ZIP" name="zip" defaultValue={a.zip ?? ''} disabled={!editable} hint="ZIP+4 for e-claims" />
            </div>
            <p className="text-sm text-slate-600 sm:col-span-2">Timezone: {a.timezone}</p>
            {editable && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <ErrorAlert error={save.error} />
                {save.isSuccess && <Alert tone="info">Saved.</Alert>}
                <div>
                  <Button type="submit" disabled={save.isPending}>
                    Save
                  </Button>
                </div>
              </div>
            )}
          </form>
        </Card>
      )}
      {a && (
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-base font-semibold text-slate-900">Caregiver recognition</h2>
          <label className="flex items-start gap-3 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={a.recognitionBadges}
              disabled={!editable || recognition.isPending}
              onChange={(e) => recognition.mutate(e.target.checked)}
            />
            <span>
              Show caregivers badges in the app for great attendance, punctuality, notes and EVV (last 90 days). Only
              positive badges are shown — nobody sees a score or a missing badge.
            </span>
          </label>
          <ErrorAlert error={recognition.error} />
        </Card>
      )}
    </div>
  );
}
