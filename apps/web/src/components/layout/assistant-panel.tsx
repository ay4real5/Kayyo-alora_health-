'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';
import { NAVIGATION } from './navigation';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  lookups?: string[];
}

const LOOKUP_LABELS: Record<string, string> = {
  find_patients: 'patients',
  find_staff: 'staff',
  list_visits: 'visits',
  list_open_shifts: 'open shifts',
  list_time_off: 'time off',
  list_claims: 'claims',
  list_pay_periods: 'payroll',
  compliance_overview: 'compliance',
};

const EXAMPLES = ['Which visits have no caregiver this week?', 'Find the patient named …', 'How do I add a new caregiver?'];

/**
 * The in-app assistant (D-092): a side panel for people with `assistant:use`, shown only when the agency has it
 * switched on. The conversation lives in memory only (it can contain patient details) — gone on reload or sign-out.
 */
export function AssistantPanel() {
  const { request, can } = useAuth();
  const allowed = can('assistant:use');
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: async () => (await request<{ enabled: boolean }>('/assistant/status')).data,
    enabled: allowed,
    staleTime: 5 * 60_000,
  });
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);

  const ask = useMutation({
    mutationFn: async (history: Turn[]) =>
      (
        await request<{ reply: string; lookups: string[] }>('/assistant/chat', {
          method: 'POST',
          body: { messages: history.map(({ role, content }) => ({ role, content })) },
        })
      ).data,
    onSuccess: (data) => setTurns((t) => [...t, { role: 'assistant', content: data.reply, lookups: data.lookups }]),
  });

  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns, ask.isPending]);

  if (!allowed || !status.data?.enabled) return null;

  const send = (text: string) => {
    const question = text.trim();
    if (!question || ask.isPending) return;
    // Keep the last 20 turns: enough context, and a bounded request.
    const history: Turn[] = [...turns, { role: 'user' as const, content: question }].slice(-20);
    if (history[0]?.role === 'assistant') history.shift();
    setTurns(history);
    setDraft('');
    ask.mutate(history);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 hover:from-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
      >
        <Sparkles aria-hidden className="h-4 w-4" /> Ask Primordial
      </button>
    );
  }

  return (
    <aside
      aria-label="Assistant"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:w-[26rem]"
    >
      <header className="flex items-center gap-3 bg-ink px-4 py-3 text-white">
        <Sparkles aria-hidden className="h-5 w-5 text-violet-300" />
        <div className="flex-1 leading-tight">
          <p className="font-semibold">Primordial assistant</p>
          <p className="text-xs text-indigo-200">Finds things and explains the system. It can’t change anything.</p>
        </div>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns([])} className="rounded-lg px-2 py-1 text-xs text-indigo-100 hover:bg-white/10">
            New chat
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="rounded-lg p-1.5 hover:bg-white/10">
          <X aria-hidden className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>Ask about your agency’s data or how to do something. For example:</p>
            <ul className="space-y-2">
              {EXAMPLES.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => (q.endsWith('…') ? setDraft(q.replace('…', '')) : send(q))}
                    className="w-full rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-left text-violet-900 hover:bg-violet-100"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <p key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet-700 px-3 py-2 text-sm text-white">
              {t.content}
            </p>
          ) : (
            <div key={i} className="max-w-[95%] space-y-1">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-sm text-slate-900">
                <RichText text={t.content} canOpen={(path) => canOpen(path, can)} onNavigate={() => setOpen(false)} />
              </div>
              {t.lookups && t.lookups.length > 0 && (
                <p className="px-1 text-xs text-slate-500">Looked up: {[...new Set(t.lookups.map((l) => LOOKUP_LABELS[l] ?? l))].join(', ')}</p>
              )}
            </div>
          ),
        )}
        {ask.isPending && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Looking that up…
          </p>
        )}
        {ask.error && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {ask.error instanceof ApiError ? ask.error.message : 'Something went wrong. Please try again.'}
          </p>
        )}
        <div ref={end} />
      </div>

      <form onSubmit={submit} className="border-t border-slate-200 p-3">
        <div className="flex items-end gap-2">
          <label htmlFor="assistant-question" className="sr-only">
            Your question
          </label>
          <textarea
            id="assistant-question"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={4000}
            placeholder="Ask a question…"
            className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || ask.isPending}
            aria-label="Send"
            className="rounded-xl bg-violet-700 p-2.5 text-white hover:bg-violet-600 disabled:bg-slate-300"
          >
            <Send aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">Answers can be wrong — check important details before acting on them.</p>
      </form>
    </aside>
  );
}

/**
 * The few bits of Markdown the assistant uses: paragraphs, "- " bullet lists, **bold** and [links](/path). Links work
 * only for paths inside the dashboard; everything else is shown as plain text (React escapes it).
 */
/** Whether this person can open a dashboard path: the sidebar entry it belongs to decides (most specific wins). */
export function canOpen(path: string, can: (permission: string) => boolean): boolean {
  const entry = NAVIGATION.filter((n) => (n.href === '/' ? path === '/' : path === n.href || path.startsWith(`${n.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return !entry || entry.permission === null || can(entry.permission);
}

export function RichText({ text, onNavigate, canOpen: allowed = () => true }: { text: string; onNavigate?: () => void; canOpen?: (path: string) => boolean }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, b) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={b} className="list-disc space-y-1 pl-5">
              {lines.map((l, i) => (
                <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ''), allowed, onNavigate)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={b}>
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(l, allowed, onNavigate)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(text: string, allowed: (path: string) => boolean, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const href = m[2]!;
      out.push(
        href.startsWith('/') && !href.startsWith('//') && allowed(href) ? (
          <Link key={m.index} href={href} onClick={onNavigate} className="font-medium text-violet-800 underline">
            {m[1]}
          </Link>
        ) : (
          m[1]
        ),
      );
    } else {
      out.push(<strong key={m.index}>{m[3]}</strong>);
    }
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}
