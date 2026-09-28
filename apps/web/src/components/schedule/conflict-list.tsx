import type { ScheduleConflict } from '@/lib/types/schedule';

/** Blocking conflicts in red, warnings in amber. */
export function ConflictList({ conflicts }: { conflicts: ScheduleConflict[] }) {
  return (
    <ul className="flex flex-col gap-1" aria-label="Schedule conflicts">
      {conflicts.map((c, i) => (
        <li
          key={`${c.code}-${i}`}
          className={`rounded-md border px-3 py-1.5 text-sm ${c.severity === 'blocking' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          <span className="font-medium">{c.severity === 'blocking' ? 'Blocks booking: ' : 'Warning: '}</span>
          {c.message}
        </li>
      ))}
    </ul>
  );
}
