'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from '@/components/layout/app-shell';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

export interface PortalMe {
  firstName: string;
  lastName: string;
  email: string;
  agency: { name: string; phone: string | null; email: string | null };
  patients: { id: string; firstName: string; lastName: string; status: string }[];
}

interface PortalContextValue {
  me: PortalMe;
  patient: PortalMe['patients'][number];
  /** `/portal/patients/<id>` — prefix for the patient's API routes. */
  base: string;
}

const PortalContext = createContext<PortalContextValue | null>(null);

/** The portal user and the patient they are looking at. Only inside the portal layout. */
export function usePortal(): PortalContextValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error('usePortal() outside the portal layout');
  return value;
}

const NAV = [
  { href: '/portal', label: 'Home' },
  { href: '/portal/visits', label: 'Visits' },
  { href: '/portal/care', label: 'Care & medications' },
  { href: '/portal/documents', label: 'Documents' },
  { href: '/portal/messages', label: 'Messages' },
] as const;

const PATIENT_KEY = 'alora.portal.patient';
const readStoredPatient = () => {
  try {
    return window.localStorage.getItem(PATIENT_KEY);
  } catch {
    return null;
  }
};

/**
 * The patient portal frame (D-058): signed-in portal users only (staff are sent to the dashboard), a patient switcher
 * for family members linked to several patients, and a simple phone-friendly menu.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const { status, user, request, logout, idleWarning } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isPortalUser = Boolean(user?.roles.includes('portal_user'));
  const mustChangePassword = Boolean(user?.mustChangePassword);
  const [chosen, setChosen] = useState<string | null>(() => (typeof window === 'undefined' ? null : readStoredPatient()));

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    // A forced password change comes first — the API refuses all other routes (P4-09).
    else if (status === 'authenticated' && mustChangePassword) router.replace('/change-password?required=1');
    else if (status === 'authenticated' && !isPortalUser) router.replace('/');
  }, [status, mustChangePassword, isPortalUser, router]);

  const me = useQuery({
    queryKey: ['portal', 'me'],
    enabled: status === 'authenticated' && isPortalUser,
    queryFn: async () => (await request<PortalMe>('/portal/me')).data,
  });

  if (status !== 'authenticated' || mustChangePassword || !isPortalUser || !me.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-sm text-slate-500" aria-live="polite">
        {me.error ? <ErrorAlert error={me.error} /> : 'Loading…'}
      </div>
    );
  }

  const patients = me.data.patients;
  const patient = patients.find((p) => p.id === chosen) ?? patients[0];
  const choose = (id: string) => {
    setChosen(id);
    try {
      window.localStorage.setItem(PATIENT_KEY, id);
    } catch {
      // Remembering the choice is only a convenience.
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 text-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark className="h-10 w-10 text-base" />
            <div className="leading-tight">
              <p className="text-lg font-semibold">{me.data.agency.name}</p>
              <p className="text-xs text-indigo-200">Patient &amp; family portal · Primordial Health</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-indigo-100 sm:inline">
              {me.data.firstName} {me.data.lastName}
            </span>
            <Link href="/change-password" className="text-sm text-indigo-100 underline hover:text-white">
              Password
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl bg-white/10 px-3.5 py-2 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
            >
              Sign out
            </button>
          </div>
        </div>
        {patient && (
          <nav aria-label="Portal" className="mx-auto flex max-w-4xl flex-wrap gap-1 px-4 pb-3">
            {NAV.map((item) => {
              const active = item.href === '/portal' ? pathname === '/portal' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-xl px-3.5 py-2 text-sm transition-colors ${active ? 'bg-white font-medium text-indigo-950 shadow-sm' : 'text-indigo-100 hover:bg-white/10 hover:text-white'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </header>

      {idleWarning && (
        <div role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          You will be signed out in about a minute because of inactivity.
        </div>
      )}

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
        {!patient ? (
          <p className="rounded-2xl border border-slate-200/70 bg-white p-6 text-sm text-slate-700 shadow-[var(--shadow-card)]">
            Your account isn&apos;t linked to a patient right now. Please call {me.data.agency.name}
            {me.data.agency.phone ? ` at ${me.data.agency.phone}` : ''}.
          </p>
        ) : (
          <>
            {patients.length > 1 && (
              <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
                Viewing
                <select
                  value={patient.id}
                  onChange={(e) => choose(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1"
                >
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <PortalContext.Provider value={{ me: me.data, patient, base: `/portal/patients/${patient.id}` }}>
              {children}
            </PortalContext.Provider>
          </>
        )}
      </main>
      <footer className="px-4 py-4 text-center text-xs text-slate-600">
        For emergencies call 911. Questions about care: {me.data.agency.phone ?? 'call your agency'}.
      </footer>
    </div>
  );
}
