'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RolePicker } from '@/components/users/role-picker';
import { Button } from '@/components/ui/button';
import { Alert, Card } from '@/components/ui/card';
import { DetailList, ErrorAlert, PageHeader, StatusBadge } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { ActivityEntry, UserView } from '@/lib/types/people';

export default function UserPage() {
  const { id } = useParams<{ id: string }>();
  const { request, can, user: me } = useAuth();
  const queryClient = useQueryClient();
  const isSelf = me?.id === id;

  const user = useQuery({ queryKey: ['users', id], queryFn: async () => (await request<UserView>(`/users/${id}`)).data });
  const activity = useQuery({
    queryKey: ['users', id, 'activity'],
    enabled: can('audit_logs:read'),
    queryFn: async () => (await request<ActivityEntry[]>(`/users/${id}/activity?limit=20`)).data,
  });

  const act = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown }) =>
      request(path, { method, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
  const run = (path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    act.mutate({ path, method, body });
  };

  if (user.isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user.data) return <ErrorAlert error={user.error} />;
  const u = user.data;
  const canManage = can('users:update') && !isSelf;
  const savedRoleIds = u.roles.map((r) => r.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {u.firstName} {u.lastName}
            <StatusBadge status={!u.isActive ? 'inactive' : u.isLocked ? 'locked' : 'active'} />
          </span>
        }
        subtitle={u.email}
        actions={
          canManage && (
            <>
              {u.isLocked && (
                <Button variant="secondary" onClick={() => run(`/users/${id}/unlock`, 'POST')}>
                  Unlock
                </Button>
              )}
              {u.is2faEnabled && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(`/users/${id}/reset-2fa`, 'POST', undefined, `Turn off two-factor sign-in for ${u.firstName}? Do this only if they lost their phone.`)
                  }
                >
                  Reset 2FA
                </Button>
              )}
              {u.isActive
                ? can('users:delete') && (
                    <Button
                      variant="danger"
                      onClick={() => run(`/users/${id}`, 'DELETE', undefined, `Deactivate ${u.firstName}? They will be signed out everywhere.`)}
                    >
                      Deactivate
                    </Button>
                  )
                : (
                    <Button onClick={() => run(`/users/${id}/reactivate`, 'POST')}>Reactivate</Button>
                  )}
            </>
          )
        }
      />
      <ErrorAlert error={act.error} />
      {isSelf && <Alert tone="info">This is your own account. You can&apos;t change your own roles or deactivate yourself.</Alert>}

      <Card className="p-5">
        <DetailList
          items={[
            ['Phone', u.phone],
            ['Two-factor sign-in', u.is2faEnabled ? 'On' : 'Off'],
            ['Last sign-in', u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'],
            ['Created', new Date(u.createdAt).toLocaleDateString()],
          ]}
        />
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        {canManage ? (
          // Keyed by the saved roles, so the editor starts fresh whenever they change on the server.
          <RoleEditor
            key={savedRoleIds.join()}
            saved={savedRoleIds}
            busy={act.isPending}
            onSave={(roleIds) => run(`/users/${id}`, 'PATCH', { roleIds })}
          />
        ) : (
          <DetailList items={[['Roles', u.roles.map((r) => humanize(r.name)).join(', ')]]} />
        )}
      </Card>

      {can('audit_logs:read') && (
        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Recent activity</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {activity.data?.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 py-2">
                <span className="text-slate-800">{humanize(entry.action)}</span>
                <span className="text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
            {activity.data?.length === 0 && <li className="py-2 text-slate-500">No activity yet.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}

function RoleEditor({ saved, busy, onSave }: { saved: string[]; busy: boolean; onSave(roleIds: string[]): void }) {
  const [roleIds, setRoleIds] = useState(saved);
  const changed = [...roleIds].sort().join() !== [...saved].sort().join();
  return (
    <>
      <RolePicker selected={roleIds} onChange={setRoleIds} />
      <Button className="self-start" disabled={!changed || busy} onClick={() => onSave(roleIds)}>
        Save roles
      </Button>
    </>
  );
}
