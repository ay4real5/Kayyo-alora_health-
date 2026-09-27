import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
