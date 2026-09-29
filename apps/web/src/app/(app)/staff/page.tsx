'use client';

import { DISCIPLINES } from '@alora/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import type { StaffSummary } from '@/lib/types/people';

export default function StaffPage() {
  const { request, can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [discipline, setDiscipline] = useState('');
  const [zip, setZip] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const staff = useQuery({
    queryKey: ['staff', { debounced, discipline, zip, active, page }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced) params.set('search', debounced);
      if (discipline) params.set('discipline', discipline);
      if (/^\d{5}$/.test(zip)) params.set('zip', zip);
      if (active) params.set('isActive', active);
      return request<StaffSummary[]>(`/staff?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Staff"
        subtitle="Caregivers and clinicians: disciplines, credentials, availability and time off."
        actions={
          <>
            <ButtonLink href="/staff/credentials" variant="secondary">
              Credentials needing attention
            </ButtonLink>
            {can('staff:create') && <ButtonLink href="/staff/new">Add staff profile</ButtonLink>}
          </>
        }
      />
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Search"
            type="search"
            className="w-full max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or employee ID"
          />
          <SelectField label="Discipline" value={discipline} onChange={(e) => { setDiscipline(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>
          <Field label="Serves ZIP" value={zip} maxLength={5} inputMode="numeric" className="w-28" onChange={(e) => { setZip(e.target.value); setPage(1); }} />
          <SelectField label="Status" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}>
            <option value="true">Active</option>
            <option value="false">Former</option>
            <option value="">All</option>
          </SelectField>
        </div>
        <ErrorAlert error={staff.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Discipline</th>
              <th className="py-2 pr-4 font-medium">Employee ID</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Languages</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {staff.data?.data.map((s) => (
              <tr key={s.id}>
                <td className="py-2 pr-4">
                  <Link href={`/staff/${s.id}`} className="font-medium text-violet-800 hover:underline">
                    {s.lastName}, {s.firstName}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-slate-700">{s.discipline}</td>
                <td className="py-2 pr-4 font-mono text-slate-700">{s.employeeId ?? '—'}</td>
                <td className="py-2 pr-4 text-slate-700">{humanize(s.employmentType)}</td>
                <td className="py-2 pr-4 text-slate-700">{s.languages.join(', ') || '—'}</td>
                <td className="py-2">
                  <StatusBadge status={s.isActive ? 'active' : 'inactive'} />
                </td>
              </tr>
            ))}
            {staff.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No staff match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {staff.data?.meta && (
          <Pager page={staff.data.meta.page} limit={staff.data.meta.limit} total={staff.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
