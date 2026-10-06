'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/auth-provider';
import { useLiveSocket } from '@/lib/realtime';
import type { AppNotification } from '@/lib/types/evv';
import { Bell } from 'lucide-react';

/**
 * The in-app inbox in the header: unread count, the latest ten, mark all read. New notifications arrive live over
 * the `/notifications` socket (D-041), which simply refreshes these queries.
 */
export function NotificationBell() {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const unread = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () =>
      (await request<{ unread: number }>('/notifications/unread-count')).data.unread,
    refetchInterval: 5 * 60_000, // safety net if the socket is down
  });
  const latest = useQuery({
    queryKey: ['notifications', 'latest'],
    enabled: open,
    queryFn: async () => (await request<AppNotification[]>('/notifications?limit=10')).data,
  });
  const markAll = useMutation({
    mutationFn: () => request('/notifications/mark-all-read', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useLiveSocket('/notifications', {
    'notification:new': () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    // New messages arrive on the same socket (D-057): refresh the badge and any open conversation.
    'message:new': () => void queryClient.invalidateQueries({ queryKey: ['messages'] }),
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const count = unread.data ?? 0;
  return (
    <div className="relative" ref={panel}>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell aria-hidden className="h-5 w-5 text-slate-600" />
        {count > 0 && (
          <span
            className="rounded-full bg-accent-600 px-1.5 text-xs font-semibold text-white"
            aria-hidden
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Button>
      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 z-[1000] mt-2 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Notifications</span>
            <Link href="/settings/notifications" className="text-xs text-slate-600 underline" onClick={() => setOpen(false)}>
              Settings
            </Link>
            {count > 0 && (
              <button
                type="button"
                className="text-xs text-brand-800 underline"
                onClick={() => markAll.mutate()}
              >
                Mark all read
              </button>
            )}
          </div>
          {latest.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
          {latest.data?.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
          <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {latest.data?.map((n) => (
              <li
                key={n.id}
                className={`rounded-md p-2 text-sm ${n.isRead ? 'text-slate-600' : 'bg-brand-50 text-slate-900'}`}
              >
                <p className="font-medium">{n.title}</p>
                {n.body && <p className="text-xs">{n.body}</p>}
                <p className="text-xs text-slate-500">{new Date(n.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
