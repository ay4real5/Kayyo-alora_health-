'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';
import { humanize } from '@/lib/labels';
import { MessagesBadge } from './messages-badge';
import { NAV_GROUPS, NAVIGATION } from './navigation';
import { NotificationBell } from './notification-bell';

/** The Kayo Health mark: a violet tile with a K. */
export function BrandMark({ className = 'h-9 w-9 text-base' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 font-bold text-white shadow-lg shadow-violet-900/30 ${className}`}
    >
      K
    </span>
  );
}

/** Signed-in frame: guards the route, shows the permission-filtered sidebar and the idle warning. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, can, logout, idleWarning } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const mustSetUp2fa = Boolean(user?.is2faRequired && !user.is2faEnabled);
  const mustChangePassword = Boolean(user?.mustChangePassword);
  // Patients and families have their own portal (D-058) and no access to staff pages.
  const isPortalUser = Boolean(user?.roles.includes('portal_user'));
  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    // A forced password change comes before everything else — the API refuses all other routes (P4-09).
    else if (status === 'authenticated' && mustChangePassword) router.replace('/change-password?required=1');
    else if (status === 'authenticated' && isPortalUser) router.replace('/portal');
    // Admins must use 2FA (D-045); the API refuses everything else until it's on.
    else if (status === 'authenticated' && mustSetUp2fa) router.replace('/setup-two-factor');
  }, [status, mustChangePassword, mustSetUp2fa, isPortalUser, router]);

  if (status !== 'authenticated' || !user || mustChangePassword || mustSetUp2fa || isPortalUser) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-slate-500" aria-live="polite">
        <BrandMark className="h-8 w-8 animate-pulse text-sm" />
        Loading…
      </div>
    );
  }

  const items = NAVIGATION.filter((item) => item.permission === null || can(item.permission));
  // The most specific entry wins (e.g. /compliance/audit-log over /compliance).
  const activeHref = items
    .map((item) => item.href)
    .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const role = humanize(user.roles.find((r) => r !== 'portal_user') ?? '');

  const nav = (label: string, onNavigate?: () => void) => (
    <nav className="flex flex-col gap-5 px-3" aria-label={label}>
      {NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (!groupItems.length) return null;
        return (
          <div key={group} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-300">{group}</p>
            {groupItems.map((item) => {
              const active = item.href === activeHref;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
                    active ? 'bg-white/10 font-medium text-white' : 'text-indigo-100 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {active && <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-full bg-violet-400" />}
                  <Icon aria-hidden className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-violet-300' : 'text-indigo-300 group-hover:text-indigo-100'}`} />
                  <span className="truncate">{item.label}</span>
                  {item.href === '/messages' && <MessagesBadge />}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const sidebar = (label: string, onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-ink">
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandMark />
        <div className="leading-tight">
          <p className="text-base font-semibold text-white">Kayo Health</p>
          <p className="text-xs text-indigo-300">Home health, simplified</p>
        </div>
      </div>
      <div className="scroll-quiet flex-1 overflow-y-auto pb-4">{nav(label, onNavigate)}</div>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 text-sm font-semibold text-white"
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-medium text-white">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-xs text-indigo-300">{role}</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-lg p-2 text-indigo-200 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-violet-400"
          >
            <LogOut aria-hidden className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 md:block">{sidebar('Main')}</aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl">{sidebar('Main (mobile)', () => setMenuOpen(false))}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200/70 bg-white/80 px-4 py-3 backdrop-blur md:px-8">
          <button
            type="button"
            className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
          </button>
          <span className="flex items-center gap-2 font-semibold text-ink md:hidden">
            <BrandMark className="h-7 w-7 text-xs" /> Kayo Health
          </span>
          <div className="ml-auto flex items-center gap-3">
            <NotificationBell />
          </div>
        </header>

        {idleWarning && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-8 py-2 text-sm text-amber-900">
            You will be signed out in about a minute because of inactivity. Move the mouse or press a key to stay
            signed in.
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
