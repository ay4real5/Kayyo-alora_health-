'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorAlert, PageHeader } from '@/components/ui/data-display';
import { Field } from '@/components/ui/field';
import { useAuth } from '@/lib/auth/auth-provider';

type Person = { id: string; firstName: string; lastName: string };
interface Message {
  id: string;
  sender: Person;
  content: string;
  isUrgent: boolean;
  document: { id: string; title: string; fileName: string } | null;
  createdAt: string;
}
interface Conversation {
  id: string;
  type: 'direct' | 'group';
  subject: string | null;
  patient: Person | null;
  participants: (Person & { left: boolean })[];
  lastMessage: Message | null;
  lastMessageAt: string | null;
  unread: number;
  left: boolean;
}
interface Contact extends Person {
  roles: string[];
}

const name = (p: Person) => `${p.firstName} ${p.lastName}`;
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Secure staff messaging (D-057). New messages arrive over the notifications socket, which refreshes these queries. */
export default function MessagesPage() {
  const { request, user } = useAuth();
  // Deep link from a notification: /messages?c=<conversation id>. (Signed-in pages render only in the browser.)
  const [selected, setSelected] = useState<string | 'new' | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('c'),
  );
  const conversations = useQuery({
    queryKey: ['messages', 'conversations'],
    queryFn: async () => (await request<Conversation[]>('/messages/conversations')).data,
  });

  const title = (c: Conversation) =>
    c.subject ??
    (c.participants
      .filter((p) => p.id !== user?.id)
      .map(name)
      .join(', ') ||
      'Conversation');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Messages"
        subtitle="Secure messages with your team. Don't use text messages or personal email for patient information."
        actions={<Button onClick={() => setSelected('new')}>New message</Button>}
      />
      <ErrorAlert error={conversations.error} />
      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="p-2">
          {conversations.data?.length === 0 && <p className="p-3 text-sm text-slate-500">No conversations yet.</p>}
          <ul aria-label="Conversations" className="flex flex-col">
            {conversations.data?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  aria-current={selected === c.id ? 'true' : undefined}
                  className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left ${selected === c.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${c.unread ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>
                      {title(c)}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{c.lastMessageAt && when(c.lastMessageAt)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-600">
                      {c.lastMessage?.isUrgent && <span className="font-medium text-red-700">Urgent · </span>}
                      {c.lastMessage?.content}
                    </span>
                    {c.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-teal-700 px-1.5 text-xs font-medium text-white" aria-label={`${c.unread} unread`}>
                        {c.unread}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        {selected === 'new' ? (
          <NewConversation onStarted={setSelected} onCancel={() => setSelected(null)} />
        ) : selected ? (
          <ConversationPane
            key={selected}
            conversation={conversations.data?.find((c) => c.id === selected)}
            id={selected}
            title={title}
            onLeft={() => setSelected(null)}
          />
        ) : (
          <Card className="flex items-center justify-center p-10 text-sm text-slate-500">
            Choose a conversation or start a new one.
          </Card>
        )}
      </div>
    </div>
  );
}

function ConversationPane({
  id,
  conversation,
  title,
  onLeft,
}: {
  id: string;
  conversation: Conversation | undefined;
  title: (c: Conversation) => string;
  onLeft: () => void;
}) {
  const { request, user } = useAuth();
  const queryClient = useQueryClient();
  const messages = useQuery({
    queryKey: ['messages', 'conversation', id],
    queryFn: async () => (await request<Message[]>(`/messages/conversations/${id}/messages?limit=100`)).data,
  });
  const newest = messages.data?.[0]?.id;

  // Opening a conversation (or a new message arriving in it) marks it read. Only the list and badge refresh
  // afterwards — not the messages — so this runs once per new message.
  useEffect(() => {
    if (!newest) return;
    void request(`/messages/conversations/${id}/read`, { method: 'POST' }).then(
      () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] }),
          queryClient.invalidateQueries({ queryKey: ['messages', 'unread'] }),
        ]),
      () => undefined,
    );
  }, [id, newest, request, queryClient]);

  const send = useMutation({
    mutationFn: (body: { content: string; isUrgent: boolean }) =>
      request(`/messages/conversations/${id}/messages`, { method: 'POST', body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messages'] }),
  });
  const leave = useMutation({
    mutationFn: () => request(`/messages/conversations/${id}/leave`, { method: 'POST' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
      onLeft();
    },
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const content = String(f.get('content') ?? '').trim();
    if (!content) return;
    send.mutate({ content, isUrgent: f.get('isUrgent') === 'on' }, { onSuccess: () => form.reset() });
  };
  const ctrlEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
  };

  return (
    <Card className="flex min-h-[28rem] flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{conversation ? title(conversation) : 'Conversation'}</h2>
          {conversation && (
            <p className="text-xs text-slate-600">
              {conversation.participants.map((p) => `${name(p)}${p.left ? ' (left)' : ''}`).join(', ')}
              {conversation.patient && (
                <>
                  {' '}
                  · About{' '}
                  <Link className="underline" href={`/patients/${conversation.patient.id}`}>
                    {name(conversation.patient)}
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
        {conversation?.type === 'group' && !conversation.left && (
          <Button variant="secondary" onClick={() => window.confirm('Leave this conversation?') && leave.mutate()}>
            Leave
          </Button>
        )}
      </div>
      <ErrorAlert error={messages.error ?? send.error ?? leave.error} />
      <ol aria-label="Messages" className="flex flex-1 flex-col-reverse gap-3 overflow-y-auto px-5 py-4" style={{ maxHeight: '32rem' }}>
        {messages.data?.map((m) => {
          const mine = m.sender.id === user?.id;
          return (
            <li key={m.id} className={`flex max-w-[80%] flex-col ${mine ? 'self-end items-end' : 'self-start'}`}>
              <span className="text-xs text-slate-500">
                {mine ? 'You' : name(m.sender)} · {when(m.createdAt)}
              </span>
              <span
                className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${mine ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-900'} ${m.isUrgent ? 'ring-2 ring-red-500' : ''}`}
              >
                {m.isUrgent && <span className="mr-1 font-semibold">Urgent:</span>}
                {m.content}
              </span>
              {m.document && <span className="text-xs text-slate-600">Attached: {m.document.title}</span>}
            </li>
          );
        })}
      </ol>
      {conversation?.left ? (
        <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">You left this conversation.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-slate-100 px-5 py-3">
          <label className="sr-only" htmlFor="message-content">
            Message
          </label>
          <textarea
            id="message-content"
            name="content"
            required
            maxLength={5000}
            rows={3}
            onKeyDown={ctrlEnter}
            placeholder="Write a message… (Ctrl+Enter to send)"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="isUrgent" /> Urgent (also sends an alert)
            </label>
            <Button type="submit" disabled={send.isPending}>
              Send
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function NewConversation({ onStarted, onCancel }: { onStarted: (id: string) => void; onCancel: () => void }) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Contact[]>([]);
  const contacts = useQuery({
    queryKey: ['messages', 'contacts', search],
    queryFn: async () =>
      (await request<Contact[]>(`/messages/contacts${search ? `?search=${encodeURIComponent(search)}` : ''}`)).data,
  });
  const start = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await request<Conversation>('/messages/conversations', { method: 'POST', body })).data,
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: ['messages'] });
      onStarted(c.id);
    },
  });
  const toggle = (c: Contact) =>
    setChosen((list) => (list.some((x) => x.id === c.id) ? list.filter((x) => x.id !== c.id) : [...list, c]));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start.mutate({
      participantIds: chosen.map((c) => c.id),
      subject: String(f.get('subject') ?? '').trim() || undefined,
      content: String(f.get('content') ?? '').trim(),
      isUrgent: f.get('isUrgent') === 'on',
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-base font-semibold text-slate-900">New message</h2>
      <ErrorAlert error={contacts.error ?? start.error} />
      <Field label="Find people" name="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul aria-label="People" className="flex max-h-48 flex-col gap-1 overflow-y-auto text-sm">
        {contacts.data?.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.some((x) => x.id === c.id)} onChange={() => toggle(c)} />
              {name(c)}
              <span className="text-xs text-slate-500">{c.roles.map((r) => r.replaceAll('_', ' ')).join(', ')}</span>
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-700">
          To: {chosen.length ? chosen.map(name).join(', ') : <span className="text-slate-500">choose people above</span>}
        </p>
        {chosen.length > 1 && <Field label="Subject (optional)" name="subject" maxLength={255} />}
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-800">
          Message
          <textarea
            name="content"
            required
            maxLength={5000}
            rows={4}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="isUrgent" /> Urgent (also sends an alert)
        </label>
        <div className="flex gap-2">
          <Button type="submit" disabled={!chosen.length || start.isPending}>
            Send
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
