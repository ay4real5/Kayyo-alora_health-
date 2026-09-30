'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/auth-provider';

export interface MessageDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string | null;
  /** A photo sent in the conversation (D-089), shown inline. */
  isPhoto: boolean;
}

/**
 * A message's attachment, loaded through the conversation (only participants can open it). Photos show inline from
 * memory — never saved by the browser as a file unless the person chooses to.
 */
export function MessageAttachment({ conversationId, document: doc, from }: { conversationId: string; document: MessageDocument; from: string }) {
  const { request } = useAuth();
  const path = `/messages/conversations/${conversationId}/attachments/${doc.id}`;
  const photo = useQuery({
    queryKey: ['message-attachment', doc.id],
    queryFn: async () => (await request<Blob>(path, { responseType: 'blob' })).data,
    enabled: doc.isPhoto,
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photo.data) return;
    const objectUrl = URL.createObjectURL(photo.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [photo.data]);
  const open = useMutation({
    mutationFn: async () => {
      const blob = (await request<Blob>(path, { responseType: 'blob' })).data;
      const objectUrl = URL.createObjectURL(blob);
      Object.assign(window.document.createElement('a'), { href: objectUrl, download: doc.fileName }).click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    },
  });

  if (doc.isPhoto) {
    if (photo.error) return <span className="text-xs text-red-700">The photo couldn’t be loaded.</span>;
    if (!url) return <span className="text-xs text-slate-500">Loading photo…</span>;
    return (
      <a href={url} target="_blank" rel="noreferrer" className="mt-1 block">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private blob, not a static asset */}
        <img src={url} alt={`Photo from ${from}`} className="max-h-64 max-w-full rounded-lg border border-slate-200 object-contain" />
      </a>
    );
  }
  return (
    <button type="button" className="text-xs text-violet-800 underline" onClick={() => open.mutate()} disabled={open.isPending}>
      {open.isPending ? 'Opening…' : `Attached: ${doc.title} — download`}
    </button>
  );
}
