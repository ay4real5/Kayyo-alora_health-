'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-provider';
import { usePortal } from './portal-shell';

export interface PortalVisit {
  id: string;
  visitType: string;
  status: string;
  date: string;
  start: string;
  end: string;
  caregiver: string | null;
}
export interface PortalMessage {
  id: string;
  sender: { id: string; firstName: string; lastName: string };
  content: string;
  createdAt: string;
}

/** GET one of the current patient's portal resources, e.g. `usePortalData<...>('/visits')`. */
export function usePortalData<T>(path: string) {
  const { request } = useAuth();
  const { base, patient } = usePortal();
  return useQuery({
    queryKey: ['portal', patient.id, path],
    queryFn: async () => (await request<T>(`${base}${path}`)).data,
  });
}

/** "Tuesday, Sep 29" from YYYY-MM-DD, without timezone shifts. */
export function longDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

/** "9:00 AM" from HH:MM. */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}
