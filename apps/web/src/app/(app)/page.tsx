'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';

function StatCard({ label, value, href, loading }: { label: string; value: number | undefined; href?: string; loading: boolean }) {
  const content = (
    <Card className="p-5 transition-colors hover:border-teal-300">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900" aria-live="polite">
        {loading ? '…' : (value ?? '—')}
      </p>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default function DashboardPage() {
  const { user, can, request } = useAuth();
  const today = useAgencyToday();

  const visitsToday = useQuery({
    queryKey: ['dashboard', 'visits-today', today],
    enabled: can('visits:read'),
    queryFn: async () => (await request<unknown[]>(`/schedule/visits?from=${today}&to=${today}&limit=1`)).meta?.total,
  });
  const activePatients = useQuery({
    queryKey: ['dashboard', 'active-patients'],
    enabled: can('patients:read'),
    queryFn: async () => (await request<unknown[]>('/patients?status=active&limit=1')).meta?.total,
  });
  const credentialAlerts = useQuery({
    queryKey: ['dashboard', 'credential-alerts'],
    enabled: can('staff:read'),
    queryFn: async () => (await request<unknown[]>('/staff/expiring-credentials?withinDays=30')).data.length,
  });
  const unread = useQuery({
    queryKey: ['dashboard', 'unread'],
    queryFn: async () => (await request<{ unread: number }>('/notifications/unread-count')).data.unread,
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome, {user?.firstName}</h1>
        <p className="text-sm text-slate-600">Here is today at a glance.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('visits:read') && (
          <StatCard label="Visits today" value={visitsToday.data} loading={visitsToday.isLoading} href="/schedule" />
        )}
        {can('patients:read') && (
          <StatCard label="Active patients" value={activePatients.data} loading={activePatients.isLoading} href="/patients" />
        )}
        {can('staff:read') && (
          <StatCard
            label="Credentials expired or expiring (30 days)"
            value={credentialAlerts.data}
            loading={credentialAlerts.isLoading}
            href="/staff"
          />
        )}
        <StatCard label="Unread notifications" value={unread.data} loading={unread.isLoading} />
      </div>
    </div>
  );
}
