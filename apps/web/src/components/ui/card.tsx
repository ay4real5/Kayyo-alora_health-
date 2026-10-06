import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-2xl border border-brand-900/[0.06] bg-white shadow-[var(--shadow-card)] ${className}`} {...props} />;
}

export function Alert({
  tone = 'error',
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'error' | 'info' | 'warning' }) {
  const tones = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]} ${className}`} {...props} />;
}
