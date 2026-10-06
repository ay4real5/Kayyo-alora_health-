import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

type Variant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white shadow-[var(--shadow-glow)] hover:-translate-y-px hover:brightness-110 disabled:opacity-60 disabled:shadow-none disabled:hover:translate-y-0',
  // Coral, for the one action on a page you most want people to notice. Dark text keeps it readable.
  accent: 'bg-gradient-to-br from-accent-300 to-accent-400 font-semibold text-accent-900 shadow-sm shadow-accent-700/25 hover:-translate-y-px hover:brightness-105 disabled:opacity-60',
  secondary: 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-800 disabled:opacity-50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-600/60',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:active:scale-100';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}

/** A link that looks like a button (never nest a <button> inside a link). */
export function ButtonLink({
  variant = 'primary',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BASE} ${VARIANTS[variant]} ${className}`} {...props} />;
}
