import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from './button';
import { Alert } from './card';

/** Page title row with optional actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Shows an API error, including every field problem the API listed (validation details). */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as unknown[]).map((d) => (typeof d === 'string' ? d : ((d as { message?: string }).message ?? '')))
      : [];
  return (
    <Alert>
      <p>{message}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {details.filter(Boolean).map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}

/** "Label: value" rows for detail pages. Empty values show a dash. */
export function DetailList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="text-sm text-slate-900">{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
    discharged: 'bg-slate-100 text-slate-700 ring-slate-500/20',
    scheduled: 'bg-sky-50 text-sky-800 ring-sky-600/20',
    cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[status] ?? tones.discharged}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}

/** Previous / next pager driven by the API's pagination meta. */
export function Pager({
  page,
  limit,
  total,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  onPage(page: number): void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>
        {total === 0 ? 'No results' : `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Formats a YYYY-MM-DD date for display without timezone shifts. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'medium' });
}
