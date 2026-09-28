'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';
import type { PatientSummary } from '@/lib/types/patients';

/** Type-ahead search over active patients (name or MRN). */
export function PatientPicker({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange(patientId: string): void;
  className?: string;
}) {
  const { request } = useAuth();
  const id = useId();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [chosen, setChosen] = useState<PatientSummary | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['patients', 'picker', term],
    enabled: term.length >= 2 && !value,
    queryFn: async () =>
      (await request<PatientSummary[]>(`/patients?status=active&limit=8&search=${encodeURIComponent(term)}`)).data,
  });

  if (value && chosen) {
    return (
      <div className={`flex flex-col gap-1 ${className}`}>
        <span className="text-sm font-medium text-slate-800">Patient</span>
        <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
          <span>
            {chosen.lastName}, {chosen.firstName} <span className="text-slate-500">{chosen.mrn ?? ''}</span>
          </span>
          <button
            type="button"
            className="text-teal-800 underline"
            onClick={() => {
              setChosen(null);
              onChange('');
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        Patient
      </label>
      <input
        id={id}
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type at least 2 letters of the name or MRN"
        autoComplete="off"
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
      />
      {results.data && results.data.length > 0 && (
        <ul role="listbox" aria-label="Matching patients" className="rounded-md border border-slate-200 bg-white shadow-sm">
          {results.data.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="w-full px-3 py-2 text-left text-sm hover:bg-teal-50"
                onClick={() => {
                  setChosen(p);
                  onChange(p.id);
                }}
              >
                {p.lastName}, {p.firstName} <span className="text-slate-500">{p.mrn ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {results.data?.length === 0 && <p className="text-xs text-slate-500">No active patients match.</p>}
    </div>
  );
}
