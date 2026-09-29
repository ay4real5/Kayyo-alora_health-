import { useId, type InputHTMLAttributes } from 'react';

/** Labelled input with an optional error message, wired up for screen readers. */
export function Field({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition-colors hover:border-slate-300 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/15 aria-invalid:border-red-600"
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
