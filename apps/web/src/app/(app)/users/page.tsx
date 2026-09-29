'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import type { RoleOption, UserView } from '@/lib/types/people';
import { roleLabel } from '@/lib/labels';

export default function UsersPage() {
  const { request, can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState('true');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const roles = useQuery({ queryKey: ['roles'], queryFn: async () => (await request<RoleOption[]>('/roles')).data });
  const users = useQuery({
    queryKey: ['users', { debounced, active, role, page }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced) params.set('search', debounced);
      if (active) params.set('isActive', active);
      if (role) params.set('role', role);
      return request<UserView[]>(`/users?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        subtitle="Everyone who can sign in to this agency, and what they may do."
        actions={can('users:create') && <ButtonLink href="/users/new">Add user</ButtonLink>}
      />
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Search"
            type="search"
            className="w-full max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or email"
          />
          <SelectField label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">Any role</option>
            {roles.data?.map((r) => (
              <option key={r.id} value={r.name}>
                {roleLabel(r.name)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Status" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
            <option value="">All</option>
          </SelectField>
        </div>
        <ErrorAlert error={users.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Email</th>
              <th className="py-2 pr-4 font-medium">Roles</th>
              <th className="py-2 pr-4 font-medium">2FA</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.data?.data.map((u) => (
              <tr key={u.id}>
                <td className="py-2 pr-4">
                  <Link href={`/users/${u.id}`} className="font-medium text-violet-800 hover:underline">
                    {u.lastName}, {u.firstName}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-slate-700">{u.email}</td>
                <td className="py-2 pr-4 text-slate-700">{u.roles.map((r) => roleLabel(r.name)).join(', ') || '—'}</td>
                <td className="py-2 pr-4 text-slate-700">{u.is2faEnabled ? 'On' : 'Off'}</td>
                <td className="py-2">
                  <StatusBadge status={!u.isActive ? 'inactive' : u.isLocked ? 'locked' : 'active'} />
                </td>
              </tr>
            ))}
            {users.data?.data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {users.data?.meta && (
          <Pager page={users.data.meta.page} limit={users.data.meta.limit} total={users.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
