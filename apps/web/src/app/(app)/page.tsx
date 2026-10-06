'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Bell, CalendarDays, CalendarPlus, HeartPulse, ShieldAlert, Sparkles, UserPlus, type LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { askPrimordial, CommandCenter } from '@/components/dashboard/command-center';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth/auth-provider';
import { useAgencyToday } from '@/lib/use-agency-today';

const TONES = {
  brand: { tile: 'bg-gradient-to-br from-brand-100 to-brand-200 text-brand-800', bar: 'from-brand-400 to-brand-600' },
  accent: { tile: 'bg-gradient-to-br from-accent-50 to-accent-200 text-accent-700', bar: 'from-accent-300 to-accent-500' },
  amber: { tile: 'bg-gradient-to-br from-amber-50 to-amber-200 text-amber-800', bar: 'from-amber-300 to-amber-500' },
  sky: { tile: 'bg-gradient-to-br from-sky-50 to-sky-200 text-sky-800', bar: 'from-sky-300 to-sky-500' },
} as const;

const noSubscribe = () => () => {};
/** "Good morning" by the viewer's clock; plain "Welcome" while rendering on the server (no hydration mismatch). */
function useGreeting(): string {
  const hour = useSyncExternalStore(noSubscribe, () => new Date().getHours(), () => -1);
  if (hour < 0) return 'Welcome';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

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
    <Card className="group relative flex items-start justify-between gap-4 overflow-hidden p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${TONES[tone].bar} opacity-80`} />
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {loading ? (
          <span aria-hidden className="skeleton mt-3 block h-8 w-16" />
        ) : (
          <p className="tabular mt-2 font-display text-4xl font-extrabold tracking-tight text-ink" aria-live="polite">
            {value ?? '—'}
          </p>
        )}
      </div>
      <span
        aria-hidden
        className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110 ${TONES[tone].tile}`}
      >
        <Icon className="h-5 w-5" />
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      {content}
    </Link>
  ) : (
    content
  );
}

export default function DashboardPage() {
  const { user, can, request } = useAuth();
  const today = useAgencyToday();
  const greeting = useGreeting();
  const assistant = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: async () => (await request<{ enabled: boolean }>('/assistant/status')).data,
    enabled: can('assistant:use'),
    staleTime: 5 * 60_000,
  });
  const chip =
    'inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/20 backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white';

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
      <div className="bg-mesh relative overflow-hidden rounded-[28px] p-6 text-white shadow-[var(--shadow-lift)] md:p-9">
        {/* Decorative rings echoing the logo's spark. */}
        <div aria-hidden className="absolute -right-10 -top-10 h-48 w-48 rounded-full border border-white/10" />
        <div aria-hidden className="absolute -right-2 -top-2 h-28 w-28 rounded-full border border-accent-300/30" />
        <div aria-hidden className="absolute right-12 top-12 h-4 w-4 rounded-full bg-accent-400 shadow-[0_0_24px_rgb(249_115_98_/_0.9)]" />
        <p className="relative inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand-100 ring-1 ring-white/15">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })}
        </p>
        <h1 className="relative mt-3 font-display text-3xl font-extrabold tracking-tight md:text-[40px] md:leading-tight">
          {greeting}, <span className="bg-gradient-to-r from-brand-100 to-accent-300 bg-clip-text text-transparent">{user?.firstName}</span>
        </h1>
        <p className="relative mt-2 max-w-xl text-brand-100">Here is today at a glance, and what needs your attention first.</p>
        <div className="relative mt-6 flex flex-wrap gap-2">
          {can('visits:create') && (
            <Link href="/schedule/new" className={chip}>
              <CalendarPlus aria-hidden className="h-4 w-4" /> New visit
            </Link>
          )}
          {can('referrals:manage') && (
            <Link href="/referrals/new" className={chip}>
              <UserPlus aria-hidden className="h-4 w-4" /> Add referral
            </Link>
          )}
          {assistant.data?.enabled && (
            <button
              type="button"
              onClick={() => askPrimordial('What should I worry about today?')}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent-300 to-accent-400 px-4 py-2 text-sm font-semibold text-accent-900 shadow-lg shadow-accent-700/30 transition-all hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-white"
            >
              <Sparkles aria-hidden className="h-4 w-4" /> Ask Primordial
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can('visits:read') && (
          <StatCard label="Visits today" value={visitsToday.data} loading={visitsToday.isLoading} href="/schedule" icon={CalendarDays} tone="brand" />
        )}
        {can('patients:read') && (
          <StatCard label="Active patients" value={activePatients.data} loading={activePatients.isLoading} href="/patients" icon={HeartPulse} tone="accent" />
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
        <StatCard label="Unread notifications" value={unread.data} loading={unread.isLoading} icon={Bell} tone="sky" />
      </div>
      <CommandCenter />
    </div>
  );
}
