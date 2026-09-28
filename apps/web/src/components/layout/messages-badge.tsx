'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-provider';

/** Unread message count next to "Messages" in the sidebar; refreshed live by the notifications socket. */
export function MessagesBadge() {
  const { request } = useAuth();
  const unread = useQuery({
    queryKey: ['messages', 'unread'],
    queryFn: async () => (await request<{ unread: number }>('/messages/unread-count')).data.unread,
    refetchInterval: 5 * 60_000, // safety net if the socket is down
  });
  if (!unread.data) return null;
  return (
    <span
      className="ml-2 rounded-full bg-teal-700 px-1.5 py-0.5 text-xs font-medium text-white"
      aria-label={`${unread.data} unread`}
    >
      {unread.data > 99 ? '99+' : unread.data}
    </span>
  );
}
