'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader, StatusBadge, formatDate } from '@/components/ui/data-display';
import { SelectField } from '@/components/ui/form-controls';
import { useAuth } from '@/lib/auth/auth-provider';
import type { ExpiringCredential } from '@/lib/types/people';

/** Agency-wide list of expired and soon-expiring credentials for active staff, soonest first. */
export default function CredentialsAttentionPage() {
  const { request } = useAuth();
  const [withinDays, setWithinDays] = useState('30');
  const list = useQuery({
    queryKey: ['staff', 'expiring-credentials', withinDays],
    queryFn: async () => (await request<ExpiringCredential[]>(`/staff/expiring-credentials?withinDays=${withinDays}`)).data,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Credentials needing attention" subtitle="Expired, or expiring soon, for active staff." />
      <Card className="flex flex-col gap-4 p-4">
        <SelectField label="Expiring within" value={withinDays} onChange={(e) => setWithinDays(e.target.value)} className="w-48">
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </SelectField>
        <ErrorAlert error={list.error} />
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Staff</th>
              <th className="py-2 pr-4 font-medium">Credential</th>
              <th className="py-2 pr-4 font-medium">Expires</th>
              <th className="py-2 font-medium">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.data?.map((c) => (
              <tr key={c.id}>
                <td className="py-2 pr-4">
                  <Link href={`/staff/${c.staff.id}`} className="font-medium text-teal-800 hover:underline">
                    {c.staff.lastName}, {c.staff.firstName}
                  </Link>{' '}
                  <span className="text-slate-500">({c.staff.discipline})</span>
                </td>
                <td className="py-2 pr-4 text-slate-700">{c.credentialName}</td>
                <td className="py-2 pr-4 text-slate-700">{formatDate(c.expiryDate)}</td>
                <td className="py-2">
                  <StatusBadge status={c.state} />
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-slate-500">
                  Nothing needs attention in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
