'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { MessagesBadge } from './messages-badge';
import { NAVIGATION } from './navigation';
import { NotificationBell } from './notification-bell';

/** Signed-in frame: guards the route, shows the permission-filtered sidebar and the idle warning. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, can, logout, idleWarning } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

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
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-live="polite">
        Loading…
      </div>
    );
  }

  const items = NAVIGATION.filter((item) => item.permission === null || can(item.permission));
  // The most specific entry wins (e.g. /compliance/audit-log over /compliance).
  const activeHref = items
    .map((item) => item.href as string)
    .filter((href) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-5 py-4 text-lg font-semibold text-teal-800">Kayo Health</div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-2 text-sm ${active ? 'bg-teal-50 font-medium text-teal-900' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {item.label}
                {item.href === '/messages' && <MessagesBadge />}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <nav className="flex gap-3 text-sm md:hidden" aria-label="Main (mobile)">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className="text-slate-700">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <NotificationBell />
            <span className="text-sm text-slate-700">
              {user.firstName} {user.lastName}
            </span>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </header>

        {idleWarning && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
            You will be signed out in about a minute because of inactivity. Move the mouse or press a key to stay
            signed in.
          </div>
        )}

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
