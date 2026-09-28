'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationChannel, NotificationType } from '@alora/shared';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface Preference {
  type: NotificationType;
  mandatory: boolean;
  inApp: boolean;
  push: boolean;
  sms: boolean;
  email: boolean;
}

/** Plain-language names; unknown types fall back to the code with spaces. */
const LABELS: Partial<Record<NotificationType, string>> = {
  shift_reminder: 'Visit reminders',
  shift_assigned: 'A visit is assigned to me',
  shift_unassigned: 'A visit is taken off my schedule',
  shift_cancelled: 'A visit is cancelled',
  shift_updated: 'A visit time or details change',
  open_shift: 'Open shifts I could take',
  swap_requested: 'Someone asks to swap a shift',
  swap_decided: 'My swap request is decided',
  missed_visit: 'Missed visits',
  late_arrival: 'Late arrivals',
  credential_expiry: 'Licences and certifications expiring',
  auth_limit: 'Authorizations running out',
  claim_status: 'Claim status changes',
  message_received: 'Urgent and patient-portal messages',
  document_signature: 'Documents to sign',
  payroll_ready: 'My pay stub is ready',
  time_off_decided: 'My time-off request is decided',
  evv_correction_decided: 'My EVV correction is decided',
  system: 'Security and serious-incident alerts',
};

const CHANNELS: { key: NotificationChannel; label: string; live: boolean }[] = [
  { key: 'inApp', label: 'In the app', live: true },
  { key: 'push', label: 'Phone push', live: false },
  { key: 'sms', label: 'Text message', live: false },
  { key: 'email', label: 'Email', live: false },
];

/** Each person chooses which alerts they get, and how (D-066). */
export default function NotificationSettingsPage() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: async () => (await request<Preference[]>('/notifications/preferences')).data,
  });
  const save = useMutation({
    mutationFn: async ({ type, channel, on }: { type: string; channel: NotificationChannel; on: boolean }) =>
      (await request<Preference[]>(`/notifications/preferences/${type}`, { method: 'PUT', body: { [channel]: on } })).data,
    // Tick the box at once; put it back if saving fails.
    onMutate: ({ type, channel, on }) => {
      const before = queryClient.getQueryData<Preference[]>(['notifications', 'preferences']);
      queryClient.setQueryData<Preference[]>(['notifications', 'preferences'], (old) =>
        old?.map((p) => (p.type === type ? { ...p, [channel]: on } : p)),
      );
      return { before };
    },
    onError: (_error, _vars, context) => queryClient.setQueryData(['notifications', 'preferences'], context?.before),
    onSuccess: (data) => queryClient.setQueryData(['notifications', 'preferences'], data),
  });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Notification settings" subtitle="Choose which alerts you get and how. Alerts never include patient details." />
      <ErrorAlert error={prefs.error ?? save.error} />
      <Card className="overflow-x-auto p-4">
        <table className="w-full text-left text-sm" aria-label="Notification settings">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4 font-medium">Alert</th>
              {CHANNELS.map((c) => (
                <th key={c.key} className="py-2 pr-4 text-center font-medium">
                  {c.label}
                  {!c.live && <span className="block text-[10px] font-normal normal-case text-slate-400">coming soon</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {prefs.data?.map((p) => {
              const label = LABELS[p.type] ?? p.type.replaceAll('_', ' ');
              return (
                <tr key={p.type}>
                  <td className="py-2 pr-4">
                    {label}
                    {p.mandatory && <span className="ml-2 text-xs text-slate-500">(always on)</span>}
                  </td>
                  {CHANNELS.map((c) => (
                    <td key={c.key} className="py-2 pr-4 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${label}: ${c.label}`}
                        checked={p[c.key]}
                        disabled={p.mandatory && c.key === 'inApp'}
                        onChange={(e) => save.mutate({ type: p.type, channel: c.key, on: e.target.checked })}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-slate-500">
          Phone push, text and email start working when the agency connects those services; your choices are saved now.
        </p>
      </Card>
    </div>
  );
}
