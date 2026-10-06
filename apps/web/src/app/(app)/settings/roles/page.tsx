'use client';

import { PERMISSION_CATALOGUE } from '@alora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  users: number;
}

const RESOURCES = Object.entries(PERMISSION_CATALOGUE) as [string, readonly string[]][];

/** Checkboxes by area; only permissions the editor holds can be ticked (the API enforces the same rule). */
function PermissionGrid({ value, onChange, holds }: { value: Set<string>; onChange: (next: Set<string>) => void; holds: (p: string) => boolean }) {
  const toggle = (p: string) => {
    const next = new Set(value);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    onChange(next);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {RESOURCES.map(([resource, actions]) => (
        <fieldset key={resource} className="rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-800">{humanize(resource)}</legend>
          <div className="flex flex-col gap-1">
            {actions.map((action) => {
              const p = `${resource}:${action}`;
              const allowed = holds(p);
              return (
                <label key={p} className={`flex items-center gap-2 text-sm ${allowed ? 'text-slate-800' : 'text-slate-400'}`} title={allowed ? undefined : 'You don’t have this permission yourself'}>
                  <input type="checkbox" checked={value.has(p)} disabled={!allowed} onChange={() => toggle(p)} />
                  {humanize(action)}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({ role, onDone }: { role?: Role; onDone: () => void }) {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [perms, setPerms] = useState(() => new Set(role?.permissions ?? []));
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      role ? request(`/roles/${role.id}`, { method: 'PATCH', body }) : request('/roles', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['roles'] });
      onDone();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const description = String(form.get('description') ?? '').trim();
    save.mutate({
      ...(role ? {} : { name: String(form.get('name') ?? '').trim() }),
      ...(description ? { description } : {}),
      permissions: [...perms],
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {!role && <Field label="Name" name="name" required pattern="[a-z][a-z0-9_]{1,49}" hint="lower_snake_case, e.g. intake_coordinator" />}
        <Field label="Description" name="description" defaultValue={role?.description ?? ''} maxLength={500} className={role ? 'sm:col-span-2' : ''} />
      </div>
      <PermissionGrid value={perms} onChange={setPerms} holds={(p) => can(p)} />
      <ErrorAlert error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || perms.size === 0}>
          {role ? 'Save role' : 'Create role'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Roles (D-099): built-in roles for reference, and the agency's own custom roles. */
export default function RolesPage() {
  const { request, can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const roles = useQuery({ queryKey: ['roles'], enabled: can('users:read'), queryFn: async () => (await request<Role[]>('/roles')).data });
  const remove = useMutation({
    mutationFn: (id: string) => request(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
  });
  if (!can('users:read')) return <PageHeader title="Roles" subtitle="You don't have access to roles." />;
  const manage = can('settings:update') && can('users:update');
  const custom = roles.data?.filter((r) => !r.isSystem) ?? [];
  const builtIn = roles.data?.filter((r) => r.isSystem) ?? [];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="Roles"
        subtitle="What each role can do. Built-in roles come with the platform; add your own for jobs that don't fit them. Give roles to people in Users."
        actions={manage && editing === null ? <Button onClick={() => setEditing('new')}>New role</Button> : null}
      />
      <ErrorAlert error={roles.error ?? remove.error} />

      {editing === 'new' && (
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-slate-900">New role</h2>
          <RoleEditor onDone={() => setEditing(null)} />
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Your agency&apos;s roles</h2>
        {custom.length === 0 && <p className="text-sm text-slate-600">None yet.</p>}
        {custom.map((r) => (
          <Card key={r.id} className="p-4">
            {editing === r.id ? (
              <>
                <h3 className="mb-3 font-semibold text-slate-900">{humanize(r.name)}</h3>
                <RoleEditor role={r} onDone={() => setEditing(null)} />
              </>
            ) : (
              <div className="flex flex-wrap items-start gap-3">
                <div className="mr-auto">
                  <h3 className="font-semibold text-slate-900">{humanize(r.name)}</h3>
                  <p className="text-sm text-slate-600">
                    {r.description ? `${r.description} · ` : ''}
                    {r.users} {r.users === 1 ? 'person' : 'people'} · {r.permissions.length} permissions
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{r.permissions.join(', ')}</p>
                </div>
                {manage && (
                  <>
                    <Button variant="secondary" onClick={() => setEditing(r.id)}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      disabled={remove.isPending || r.users > 0}
                      title={r.users > 0 ? 'Give its people another role first' : undefined}
                      onClick={() => window.confirm(`Delete the ${humanize(r.name)} role?`) && remove.mutate(r.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            )}
          </Card>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-slate-900">Built-in roles</h2>
        <Card className="divide-y divide-slate-100">
          {builtIn.map((r) => (
            <div key={r.id} className="p-4">
              <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span>
                  <span className="font-medium text-slate-900">{humanize(r.name)}</span>
                  <span className="ml-2 text-sm text-slate-600">
                    {r.users} {r.users === 1 ? 'person' : 'people'} · {r.permissions.length} permissions
                  </span>
                </span>
                <span className="text-sm text-brand-800">{open === r.id ? 'Hide' : 'Show'}</span>
              </button>
              {open === r.id && (
                <>
                  {r.description && <p className="mt-2 text-sm text-slate-600">{r.description}</p>}
                  <p className="mt-2 text-xs text-slate-500">{r.permissions.join(', ')}</p>
                </>
              )}
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}
