import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-violet-600 to-violet-700 text-white shadow-sm shadow-violet-900/20 hover:from-violet-700 hover:to-violet-800 disabled:from-violet-600/60 disabled:to-violet-700/60',
  secondary: 'border border-slate-200 bg-white text-slate-800 shadow-sm hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-600/60',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 disabled:cursor-not-allowed';

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
