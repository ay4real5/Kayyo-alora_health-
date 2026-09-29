import { CalendarCheck2, FileCheck2, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from './app-shell';

const POINTS = [
  { icon: CalendarCheck2, text: 'Schedules, visits and EVV in one place' },
  { icon: FileCheck2, text: 'Clean claims, built for Virginia Medicaid' },
  { icon: ShieldCheck, text: 'HIPAA-minded: encrypted, audited, secure' },
];

/** Signed-out pages (sign in, password reset, 2FA setup): brand panel on the left, the form on the right (D-079). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section
        aria-label="Kayo Health"
        className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 p-12 text-white lg:flex lg:flex-col"
      >
        <div aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-violet-500/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="h-11 w-11 text-lg" />
          <span className="text-xl font-semibold">Kayo Health</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Care at home, run beautifully.</p>
          <p className="mt-3 text-indigo-100">Everything your agency needs — from the first visit to the last claim.</p>
          <ul className="mt-8 flex flex-col gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-indigo-50">
                <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <BrandMark className="h-9 w-9 text-sm" />
            <span className="text-lg font-semibold text-ink">Kayo Health</span>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
