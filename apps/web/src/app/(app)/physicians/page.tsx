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
import type { Physician } from '@/lib/types/people';

export default function PhysiciansPage() {
  const { request, can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['physicians', { debounced, active, page }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (debounced) params.set('search', debounced);
      if (active) params.set('isActive', active);
      return request<Physician[]>(`/physicians?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Physicians"
        subtitle="Referring and ordering physicians for this agency."
        actions={can('physicians:create') && <ButtonLink href="/physicians/new">Add physician</ButtonLink>}
      />
      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Search"
            type="search"
            className="w-full max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, practice or NPI"
          />
          <SelectField label="Status" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
            <option value="">All</option>
          </SelectField>
        </div>
        <ErrorAlert error={query.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">NPI</th>
              <th className="py-2 pr-4 font-medium">Practice</th>
              <th className="py-2 pr-4 font-medium">Fax</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {query.data?.data.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-4">
                  <Link href={`/physicians/${p.id}`} className="font-medium text-violet-800 hover:underline">
                    Dr. {p.firstName} {p.lastName}
                  </Link>
                </td>
                <td className="py-2 pr-4 font-mono text-slate-700">{p.npi ?? '—'}</td>
                <td className="py-2 pr-4 text-slate-700">{p.practiceName ?? '—'}</td>
                <td className="py-2 pr-4 text-slate-700">{p.fax ?? '—'}</td>
                <td className="py-2">
                  <StatusBadge status={p.isActive ? 'active' : 'inactive'} />
                </td>
              </tr>
            ))}
            {query.data?.data.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-slate-500">
                  No physicians match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {query.data?.meta && (
          <Pager page={query.data.meta.page} limit={query.data.meta.limit} total={query.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
