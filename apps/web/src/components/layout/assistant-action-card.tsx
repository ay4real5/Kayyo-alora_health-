'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-provider';

export interface ActionPreview {
  kind: string;
  title: string;
  details: string[];
  params: Record<string, unknown>;
  confirmLabel: string;
}

interface ActionResult {
  message: string;
  link?: string;
  file?: { fileName: string; content: string; mimeType: string };
}

/**
 * A change the assistant prepared (D-095). Nothing happens until the person presses the button; the API then runs the
 * normal action with their own permissions and checks everything again.
 */
export function AssistantActionCard({ action, onNavigate }: { action: ActionPreview; onNavigate?: () => void }) {
  const { request } = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const run = useMutation({
    mutationFn: async () => (await request<ActionResult>('/assistant/actions', { method: 'POST', body: { kind: action.kind, params: action.params } })).data,
    onSuccess: async (result) => {
      if (result.file) {
        const url = URL.createObjectURL(new Blob([result.file.content], { type: result.file.mimeType }));
        Object.assign(document.createElement('a'), { href: url, download: result.file.fileName }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      // Whatever page is open behind the panel should show the change.
      await queryClient.invalidateQueries();
    },
  });

  if (dismissed) return <p className="px-1 text-xs text-slate-500">Cancelled — nothing was changed.</p>;

  return (
    <div className="rounded-2xl border border-violet-200 bg-white p-3 text-sm shadow-sm">
      <p className="flex items-start gap-2 font-semibold text-slate-900">
        <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
        {action.title}
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-9 text-slate-700">
        {action.details.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      {run.isSuccess ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-2 text-emerald-800">
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {run.data.message}{' '}
            {run.data.link && (
              <Link href={run.data.link} onClick={onNavigate} className="font-medium underline">
                Open
              </Link>
            )}
          </span>
        </p>
      ) : (
        <>
          {run.error && (
            <p role="alert" className="mt-2 rounded-xl bg-rose-50 px-2.5 py-2 text-rose-800">
              {run.error instanceof ApiError ? run.error.message : 'That didn’t work. Please try again.'}
            </p>
          )}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={run.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-1.5 font-semibold text-white hover:bg-violet-600 disabled:bg-slate-400"
            >
              {run.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {action.confirmLabel}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              disabled={run.isPending}
              className="rounded-xl border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
