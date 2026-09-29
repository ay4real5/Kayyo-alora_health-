'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, type FormEvent } from 'react';
import { usePortalData, type PortalMessage } from '@/components/portal/portal-data';
import { usePortal } from '@/components/portal/portal-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert } from '@/components/ui/data-display';
import { useAuth } from '@/lib/auth/auth-provider';

interface Thread {
  conversationId: string | null;
  unread: number;
  messages: PortalMessage[];
}

/** Messages with the care team about this patient. Not for emergencies. */
export default function PortalMessages() {
  const { request, user } = useAuth();
  const { base, patient } = usePortal();
  const queryClient = useQueryClient();
  const thread = usePortalData<Thread>('/messages?limit=100');
  const unread = thread.data?.unread ?? 0;

  useEffect(() => {
    if (!unread) return;
    void request(`${base}/messages/read`, { method: 'POST' }).then(
      () => queryClient.invalidateQueries({ queryKey: ['portal', patient.id] }),
      () => undefined,
    );
  }, [unread, base, patient.id, request, queryClient]);

  const send = useMutation({
    mutationFn: async (content: string) =>
      (await request<PortalMessage>(`${base}/messages`, { method: 'POST', body: { content } })).data,
    onSuccess: (sent) => {
      // Show it right away; the refetch then brings the thread fully up to date.
      queryClient.setQueryData<Thread>(['portal', patient.id, '/messages?limit=100'], (old) =>
        old ? { ...old, messages: [sent, ...old.messages] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['portal', patient.id] });
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const content = String(new FormData(form).get('content') ?? '').trim();
    if (content) send.mutate(content, { onSuccess: () => form.reset() });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Not for emergencies — call 911. For something urgent, phone the office. Messages are read during office hours.
      </p>
      <ErrorAlert error={thread.error ?? send.error} />
      <Card className="flex flex-col">
        <ol aria-label="Messages" className="flex max-h-[28rem] flex-col-reverse gap-3 overflow-y-auto p-4">
          {thread.data?.messages.length === 0 && (
            <li className="text-sm text-slate-600">No messages yet. Write to the care team below.</li>
          )}
          {thread.data?.messages.map((m) => {
            const mine = m.sender.id === user?.id;
            return (
              <li key={m.id} className={`flex max-w-[85%] flex-col ${mine ? 'items-end self-end' : 'self-start'}`}>
                <span className="text-xs text-slate-500">
                  {mine ? 'You' : `${m.sender.firstName} ${m.sender.lastName}`} ·{' '}
                  {new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <span
                  className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${mine ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-900'}`}
                >
                  {m.content}
                </span>
              </li>
            );
          })}
        </ol>
        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-slate-100 p-4">
          <label htmlFor="portal-message" className="text-sm font-medium text-slate-800">
            Write to the care team
          </label>
          <textarea
            id="portal-message"
            name="content"
            required
            maxLength={5000}
            rows={4}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-700/20"
          />
          <div>
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
