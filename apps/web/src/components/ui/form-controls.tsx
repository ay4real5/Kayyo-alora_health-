import { useId, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const CONTROL =
  'rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20';

/** Labelled <select>. */
export function SelectField({
  label,
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select id={id} className={CONTROL} {...props}>
        {children}
      </select>
    </div>
  );
}

/** Labelled <textarea>. */
export function TextAreaField({
  label,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <textarea id={id} rows={3} className={CONTROL} {...props} />
    </div>
  );
}
