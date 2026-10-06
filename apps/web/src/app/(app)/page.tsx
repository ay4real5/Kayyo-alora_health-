'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bell, CalendarDays, HeartPulse, ShieldAlert, type LucideIcon } from 'lucide-react';
import { CommandCenter } from '@/components/dashboard/command-center';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';

const TONES = {
  violet: 'bg-violet-100 text-violet-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  amber: 'bg-amber-100 text-amber-700',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-700',
} as const;

function StatCard({
  label,
  value,
  href,
  loading,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | undefined;
  href?: string;
  loading: boolean;
  icon: LucideIcon;
  tone: keyof typeof TONES;
}) {
  const content = (
    <Card className="group flex items-start justify-between gap-4 p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-ink" aria-live="polite">
          {loading ? '…' : (value ?? '—')}
        </p>
      </div>
      <span aria-hidden className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${TONES[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
      {content}
    </Link>
  ) : (
    content
  );
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
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 p-6 text-white shadow-[var(--shadow-lift)] md:p-8">
        <div aria-hidden className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-500/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-20 right-40 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <p className="relative text-sm font-medium text-indigo-200">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
        </p>
        <h1 className="relative mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Welcome, {user?.firstName}</h1>
        <p className="relative mt-1 text-sm text-indigo-100">Here is today at a glance — and what needs your attention.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('visits:read') && (
          <StatCard label="Visits today" value={visitsToday.data} loading={visitsToday.isLoading} href="/schedule" icon={CalendarDays} tone="violet" />
        )}
        {can('patients:read') && (
          <StatCard label="Active patients" value={activePatients.data} loading={activePatients.isLoading} href="/patients" icon={HeartPulse} tone="fuchsia" />
        )}
        {can('staff:read') && (
          <StatCard
            label="Credentials expired or expiring (30 days)"
            value={credentialAlerts.data}
            loading={credentialAlerts.isLoading}
            href="/staff/credentials"
            icon={ShieldAlert}
            tone="amber"
          />
        )}
        <StatCard label="Unread notifications" value={unread.data} loading={unread.isLoading} icon={Bell} tone="indigo" />
      </div>
      <CommandCenter />
    </div>
  );
}
