'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { NAVIGATION } from './navigation';

/** Signed-in frame: guards the route, shows the permission-filtered sidebar and the idle warning. */
export function AppShell({ children }: { children: ReactNode }) {
  const { status, user, can, logout, idleWarning } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-live="polite">
        Loading…
      </div>
    );
  }

  const items = NAVIGATION.filter((item) => item.permission === null || can(item.permission));
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-5 py-4 text-lg font-semibold text-teal-800">Alora Health</div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-3 py-2 text-sm ${active ? 'bg-teal-50 font-medium text-teal-900' : 'text-slate-700 hover:bg-slate-100'}`}
              >
                {item.label}
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
