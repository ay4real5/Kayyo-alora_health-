'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager, StatusBadge, formatDate } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';
import type { PatientSummary } from '@/lib/types/patients';

const PAGE_SIZE = 25;

export default function PatientsPage() {
  const { request, can } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);

  // Search after the user pauses typing. The term stays in component state — never in the browser URL/history.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['patients', { search: debounced, status, page }],
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (debounced) params.set('search', debounced);
      if (status) params.set('status', status);
      return request<PatientSummary[]>(`/patients?${params}`);
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Patients"
        subtitle="Search by name or medical record number."
        actions={
          can('patients:create') && <ButtonLink href="/patients/new">Admit patient</ButtonLink>
        }
      />

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field
            label="Search"
            type="search"
            className="w-full max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or MRN"
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="active">Active</option>
            <option value="discharged">Discharged</option>
            <option value="">All</option>
          </SelectField>
        </div>

        <ErrorAlert error={query.error} />

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">MRN</th>
                <th className="py-2 pr-4 font-medium">Date of birth</th>
                <th className="py-2 pr-4 font-medium">City</th>
                <th className="py-2 pr-4 font-medium">Admitted</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {query.data?.data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-4">
                    <Link href={`/patients/${p.id}`} className="font-medium text-brand-800 hover:underline">
                      {p.lastName}, {p.firstName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-700">{p.mrn ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-700">{formatDate(p.dateOfBirth)}</td>
                  <td className="py-2 pr-4 text-slate-700">{p.city ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-700">{formatDate(p.admissionDate) || '—'}</td>
                  <td className="py-2">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
              {query.isLoading && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    Loading…
                  </td>
                </tr>
              )}
              {query.data && query.data.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No patients match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {query.data?.meta && (
          <Pager page={query.data.meta.page} limit={query.data.meta.limit} total={query.data.meta.total} onPage={setPage} />
        )}
      </Card>
    </div>
  );
}
