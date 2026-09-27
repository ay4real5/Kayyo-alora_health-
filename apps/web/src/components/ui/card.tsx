import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`} {...props} />;
}

export function Alert({
  tone = 'error',
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'error' | 'info' | 'warning' }) {
  const tones = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
  };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm ${tones[tone]} ${className}`} {...props} />;
}
