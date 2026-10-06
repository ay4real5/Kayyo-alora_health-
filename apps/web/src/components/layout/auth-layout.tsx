import { CalendarCheck2, FileCheck2, HeartHandshake, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

const POINTS = [
  { icon: CalendarCheck2, text: 'Schedules, visits and EVV in one place' },
  { icon: Sparkles, text: 'AI that drafts notes and spots what needs attention' },
  { icon: FileCheck2, text: 'Clean claims, built for Virginia Medicaid' },
  { icon: ShieldCheck, text: 'HIPAA-minded: encrypted, audited, secure' },
];

/** Signed-out pages (sign in, password reset, 2FA setup): brand panel on the left, the form on the right (D-103). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section aria-label="Primordial Health" className="bg-mesh relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        {/* Floating glass card: a glimpse of the product. */}
        <div aria-hidden className="absolute right-10 top-28 w-64 rotate-3 rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-brand-100">
            <HeartHandshake className="h-4 w-4 text-accent-300" /> Today
          </div>
          <p className="mt-2 font-display text-3xl font-extrabold">
            18 <span className="text-base font-semibold text-brand-200">visits</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full w-4/5 rounded-full bg-gradient-to-r from-brand-300 to-accent-400" />
          </div>
          <p className="mt-2 text-xs text-brand-100">All covered · 3 notes to review</p>
        </div>

        <div className="relative">
          <Logo tone="dark" />
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="font-display text-4xl font-extrabold leading-[1.1] tracking-tight">
            Care at home,
            <br />
            <span className="bg-gradient-to-r from-brand-200 via-brand-100 to-accent-300 bg-clip-text text-transparent">run beautifully.</span>
          </p>
          <p className="mt-4 text-brand-100">Everything your agency needs, from the first call to the last claim.</p>
          <ul className="mt-8 flex flex-col gap-3.5">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-brand-50">
                <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-4 w-4 text-accent-200" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <div className="bg-mesh-light flex items-center justify-center p-4 sm:p-8 lg:bg-none">
        <div className="w-full max-w-md animate-fade-in">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
