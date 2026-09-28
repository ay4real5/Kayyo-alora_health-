'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, Pager } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';

interface AuditEntry {
  id: string;
  createdAt: string;
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null } | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: { outcome?: string; status?: number; route?: string } | null;
  ipAddress: string | null;
}
interface HipaaCheck {
  area: string;
  item: string;
  ok: boolean;
  detail: string;
}

/** Audit log search and the HIPAA safeguards checklist (D-062). Administrators only. */
export default function AuditLogPage() {
  const { request, can } = useAuth();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const allowed = can('audit_logs:read');
  const log = useQuery({
    queryKey: ['compliance', 'audit', filters, page],
    enabled: allowed,
    placeholderData: keepPreviousData,
    queryFn: () => request<AuditEntry[]>(`/compliance/audit-logs?${new URLSearchParams({ page: String(page), limit: '50', ...filters })}`),
  });
  const checklist = useQuery({
    queryKey: ['compliance', 'hipaa'],
    enabled: allowed,
    queryFn: async () => (await request<HipaaCheck[]>('/compliance/hipaa-checklist')).data,
  });
  if (!allowed) return <PageHeader title="Audit log" subtitle="Only administrators can see the audit log." />;

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next: Record<string, string> = {};
    for (const k of ['action', 'resourceType', 'resourceId', 'from', 'to']) {
      const v = String(f.get(k) ?? '').trim();
      if (v) next[k] = k === 'action' ? v.toUpperCase() : v;
    }
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Audit log" subtitle="Who looked at or changed what, and when. Searching is itself recorded." />
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold text-slate-900">HIPAA safeguards</h2>
        <ErrorAlert error={checklist.error} />
        <ul aria-label="HIPAA safeguards" className="flex flex-col gap-1 text-sm">
          {checklist.data?.map((c) => (
            <li key={c.item} className="flex gap-2">
              <span aria-label={c.ok ? 'OK' : 'Needs attention'} className={c.ok ? 'text-emerald-700' : 'text-amber-700'}>
                {c.ok ? '✓' : '!'}
              </span>
              <span>
                <span className="font-medium text-slate-900">{c.item}</span> <span className="text-slate-500">({c.area})</span>
                <span className="block text-xs text-slate-600">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <Field label="Action" name="action" placeholder="e.g. VIEW_PATIENTS" className="w-48" />
          <Field label="Record type" name="resourceType" placeholder="e.g. patients" className="w-40" />
          <Field label="Record ID" name="resourceId" className="w-72" />
          <Field label="From" name="from" type="date" />
          <Field label="To" name="to" type="date" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <ErrorAlert error={log.error} />
        <table className="w-full text-left text-sm" aria-label="Audit entries">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Who</th>
              <th className="py-2 pr-4 font-medium">Action</th>
              <th className="py-2 pr-4 font-medium">Record</th>
              <th className="py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {log.data?.data.map((e) => (
              <tr key={e.id}>
                <td className="py-2 pr-4 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="py-2 pr-4">{e.user ? `${e.user.firstName ?? ''} ${e.user.lastName ?? ''}`.trim() || e.user.email : 'System'}</td>
                <td className="py-2 pr-4 font-mono text-xs">{e.action}</td>
                <td className="py-2 pr-4 text-xs text-slate-600">
                  {e.resourceType}
                  {e.resourceId && <span className="block font-mono">{e.resourceId}</span>}
                </td>
                <td className={`py-2 text-xs ${e.details?.outcome === 'error' ? 'text-red-700' : 'text-slate-600'}`}>
                  {e.details?.outcome ?? '—'}
                  {e.details?.status ? ` (${e.details.status})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {log.data?.meta && <Pager page={log.data.meta.page} limit={log.data.meta.limit} total={log.data.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
