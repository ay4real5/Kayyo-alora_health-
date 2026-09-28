'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';

interface PortalAccess {
  portalUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    lastLoginAt: string | null;
    mustChangePassword: boolean;
  } | null;
  temporaryPassword?: string;
}

/** Who can sign in to the patient portal for this patient (D-058). The temporary password is shown once. */
export function PortalAccessPanel({ patientId }: { patientId: string }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [temporary, setTemporary] = useState<{ password: string; email: string } | null>(null);
  const key = ['patients', patientId, 'portal-access'];
  const access = useQuery({
    queryKey: key,
    queryFn: async () => (await request<PortalAccess>(`/patients/${patientId}/portal-access`)).data,
  });
  const act = useMutation({
    mutationFn: async ({ path = '', method, body }: { path?: string; method: 'POST' | 'DELETE'; body?: unknown }) =>
      (await request<PortalAccess>(`/patients/${patientId}/portal-access${path}`, { method, body })).data,
    onSuccess: (data) => {
      setTemporary(data?.temporaryPassword && data.portalUser ? { password: data.temporaryPassword, email: data.portalUser.email } : null);
      return queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const canManage = can('patients:update');
  const user = access.data?.portalUser;

  const grant = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    act.mutate({
      method: 'POST',
      body: {
        email: String(f.get('email') ?? '').trim(),
        firstName: String(f.get('firstName') ?? '').trim(),
        lastName: String(f.get('lastName') ?? '').trim(),
      },
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-slate-900">Patient portal</h2>
      <ErrorAlert error={access.error ?? act.error} />
      {temporary && (
        <Alert tone="warning">
          <p>
            Temporary password for <strong>{temporary.email}</strong>:{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-base" aria-label="Temporary password">
              {temporary.password}
            </code>
          </p>
          <p className="mt-1 text-xs">
            Give it to them in person or by phone — it is shown only once. They must choose their own password at first
            sign-in.
          </p>
        </Alert>
      )}
      {access.data && !user && (
        <p className="text-sm text-slate-600">
          No one can sign in to the portal for this patient. A family member (or the patient) can see visits, the plan of
          care, medications, shared documents, and message the care team.
        </p>
      )}
      {user && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-medium text-slate-900">
              {user.firstName} {user.lastName}
            </span>{' '}
            · {user.email}
          </p>
          <p className="text-xs text-slate-600">
            {user.mustChangePassword
              ? 'Has not signed in with their own password yet.'
              : user.lastLoginAt
                ? `Last signed in ${new Date(user.lastLoginAt).toLocaleString()}`
                : 'Has not signed in yet.'}
          </p>
          {canManage && (
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                className="underline"
                onClick={() =>
                  window.confirm(`Give ${user.firstName} a new temporary password? They'll be signed out.`) &&
                  act.mutate({ path: '/reset-password', method: 'POST' })
                }
              >
                Reset password
              </button>
              <button
                type="button"
                className="text-slate-500 underline"
                onClick={() =>
                  window.confirm(`Remove ${user.firstName}'s portal access to this patient?`) &&
                  act.mutate({ method: 'DELETE' })
                }
              >
                Remove access
              </button>
            </div>
          )}
        </div>
      )}
      {access.data && !user && canManage && (
        <form onSubmit={grant} className="grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <Field label="Portal email" name="email" type="email" required className="sm:col-span-2" />
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <div>
            <Button type="submit" variant="secondary" disabled={act.isPending}>
              Give portal access
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
